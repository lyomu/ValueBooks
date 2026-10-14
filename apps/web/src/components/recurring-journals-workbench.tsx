'use client';

import type { LedgerAccount, RecurringCadence } from '@valuebooks/contracts';
import {
  Button,
  Card,
  EmptyState,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
} from '@valuebooks/ui';
import { Play, Plus, Save, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';
import { EntityDetailView } from './master-detail/entity-detail-view';
import { RecordDetailWorkspace } from './record-detail-workspace';

type TemplateListResponse = { data: RecurringJournalTemplateView[] };
type AccountListResponse = { data: LedgerAccount[] };

const cadenceOptions: readonly RecurringCadence[] = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'];

interface RecurringJournalTemplateView {
  id: string;
  name: string;
  memo: string | null;
  cadence: RecurringCadence;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  active: boolean;
  lines: Array<{
    id: string;
    accountId: string;
    debitMinor: string;
    creditMinor: string;
    description: string | null;
  }>;
}

export function RecurringJournalsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'journals.recurring.view');
  const canManage = hasPermission(organization, 'journals.recurring.manage');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedTemplateId = searchParams.get('template');

  function selectTemplate(templateId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (templateId) params.set('template', templateId);
    else params.delete('template');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [templates, setTemplates] = useState<TemplateListResponse['data'] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [memo, setMemo] = useState('');
  const [cadence, setCadence] = useState<RecurringCadence>('MONTHLY');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [lines, setLines] = useState<
    Array<{ accountId: string; debitMinor: string; creditMinor: string }>
  >([
    { accountId: '', debitMinor: '', creditMinor: '' },
    { accountId: '', debitMinor: '', creditMinor: '' },
  ]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [accountResponse, templateResponse] = await Promise.all([
        apiRequest<AccountListResponse>(`/organizations/${organizationId}/accounts`),
        apiRequest<TemplateListResponse>(`/organizations/${organizationId}/recurring-journals`),
      ]);
      setAccounts(accountResponse.data);
      setTemplates(templateResponse.data);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Recurring journals could not be loaded.',
      );
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const accountLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts) map.set(account.id, `${account.code}: ${account.name}`);
    return map;
  }, [accounts]);

  const selectedTemplate = (templates ?? []).find((template) => template.id === selectedTemplateId);

  if (!canView) return <ForbiddenState />;

  async function createTemplate() {
    if (!organizationId) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/recurring-journals`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          memo: memo || undefined,
          cadence,
          startDate,
          endDate: endDate || undefined,
          lines: lines
            .filter((line) => line.accountId)
            .map((line) => ({
              accountId: line.accountId,
              debitMinor: line.debitMinor === '' ? '0' : line.debitMinor,
              creditMinor: line.creditMinor === '' ? '0' : line.creditMinor,
            })),
        }),
      });
      setShowCreate(false);
      setName('');
      setMemo('');
      setLines([
        { accountId: '', debitMinor: '', creditMinor: '' },
        { accountId: '', debitMinor: '', creditMinor: '' },
      ]);
      setNotice('Recurring journal template created.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The template could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function runDue() {
    if (!organizationId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest<{ data: unknown[] }>(
        `/organizations/${organizationId}/recurring-journals/run-due`,
        { method: 'POST' },
      );
      setNotice(`${response.data.length} due journal(s) generated.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The sweep could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(templateId: string, action: 'deactivate' | 'reactivate') {
    if (!organizationId) return;
    setBusy(true);
    try {
      await apiRequest(
        `/organizations/${organizationId}/recurring-journals/${templateId}/${action}`,
        {
          method: 'POST',
        },
      );
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The update failed.');
    } finally {
      setBusy(false);
    }
  }

  if (selectedTemplate) {
    return (
      <RecordDetailWorkspace
        variant="compact"
        title="Recurring journals"
        records={templates ?? []}
        selectedId={selectedTemplate.id}
        onSelect={(template) => selectTemplate(template.id)}
        onClose={() => selectTemplate(null)}
        searchText={(template) => `${template.name} ${template.memo ?? ''}`}
        railHeader={<h1>Recurring journals</h1>}
        renderRailRecord={(template) => (
          <>
            <span className="rb-customer-rail__line">
              <strong>{template.name}</strong>
            </span>
            <span className="rb-customer-rail__meta">
              {template.cadence.toLowerCase()} · next {template.nextRunDate}
            </span>
          </>
        )}
        detailTitle={(template) => <h1>{template.name}</h1>}
        headerActions={(template) =>
          canManage ? (
            <Button
              size="sm"
              variant={template.active ? 'ghost' : 'outline'}
              disabled={busy}
              onClick={() =>
                void toggle(template.id, template.active ? 'deactivate' : 'reactivate')
              }
            >
              {template.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          ) : null
        }
        renderDetail={(template) => (
          <EntityDetailView>
            <Card className="rb-bill-detail">
              <header className="rb-bill-detail__head">
                <div>
                  <p className="rb-bill-detail__eyebrow">Template</p>
                  <h2>{template.name}</h2>
                </div>
                <StatusBadge status={template.active ? 'ACTIVE' : 'INACTIVE'} />
              </header>
              <dl className="rb-bill-detail__totals">
                <div>
                  <dt>Cadence</dt>
                  <dd>{template.cadence}</dd>
                </div>
                <div>
                  <dt>Start date</dt>
                  <dd>{template.startDate}</dd>
                </div>
                <div>
                  <dt>End date</dt>
                  <dd>{template.endDate ?? 'None'}</dd>
                </div>
                <div>
                  <dt>Next run</dt>
                  <dd>{template.nextRunDate}</dd>
                </div>
                <div>
                  <dt>Memo</dt>
                  <dd>{template.memo ?? '—'}</dd>
                </div>
              </dl>
            </Card>
            <Card className="rb-bill-detail">
              <h2>Lines</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1 pr-2 font-medium">Account</th>
                    <th className="py-1 pr-2 font-medium">Debit</th>
                    <th className="py-1 pr-2 font-medium">Credit</th>
                    <th className="py-1 pr-2 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {template.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="py-1 pr-2">
                        {accountLabels.get(line.accountId) ?? line.accountId}
                      </td>
                      <td className="py-1 pr-2">{line.debitMinor}</td>
                      <td className="py-1 pr-2">{line.creditMinor}</td>
                      <td className="py-1 pr-2">{line.description ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </EntityDetailView>
        )}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recurring journals"
        description="Schedules balanced journals for rent, depreciation, and accruals. Each occurrence is generated idempotently."
      />

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </div>
      ) : null}

      <Card className="p-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold">Templates</h2>
          <div className="flex gap-2">
            {canManage ? (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void runDue()}>
                  <Play aria-hidden className="size-4" /> Run due now
                </Button>
                <Button size="sm" onClick={() => setShowCreate((open) => !open)}>
                  <Plus aria-hidden className="size-4" /> New template
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {templates === null ? (
          <Skeleton className="mt-3 h-20" />
        ) : templates.length === 0 && !showCreate ? (
          <EmptyState
            title="No recurring journal templates"
            description="Create a schedule to automate repeated manual journals."
          />
        ) : (
          <ul className="divide-y">
            {templates.map((template) => (
              <li
                key={template.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <div>
                  <button
                    type="button"
                    className="font-medium underline-offset-2 hover:underline"
                    onClick={() => selectTemplate(template.id)}
                  >
                    {template.name}
                  </button>
                  <span className="text-slate-500">
                    {' · '}Runs {template.cadence.toLowerCase()}, next {template.nextRunDate}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={template.active ? 'ACTIVE' : 'INACTIVE'} />
                  {canManage ? (
                    <Button
                      size="sm"
                      variant={template.active ? 'ghost' : 'outline'}
                      disabled={busy}
                      onClick={() =>
                        void toggle(template.id, template.active ? 'deactivate' : 'reactivate')
                      }
                    >
                      {template.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {showCreate && canManage ? (
        <Card className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="rjt-name">Name</Label>
              <Input id="rjt-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="rjt-memo">Memo</Label>
              <Input id="rjt-memo" value={memo} onChange={(event) => setMemo(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="rjt-cadence">Cadence</Label>
              <Select
                id="rjt-cadence"
                value={cadence}
                onChange={(event) => setCadence(event.target.value as RecurringCadence)}
              >
                {cadenceOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-3">
              <div>
                <Label htmlFor="rjt-start">Start date</Label>
                <Input
                  id="rjt-start"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rjt-end">End date (optional)</Label>
                <Input
                  id="rjt-end"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-2 font-medium">Account</th>
                <th className="py-1 pr-2 font-medium">Debit</th>
                <th className="py-1 pr-2 font-medium">Credit</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td className="py-1 pr-2">
                    <Select
                      aria-label="Account"
                      value={line.accountId}
                      onChange={(event) =>
                        setLines(
                          lines.map((l, i) =>
                            i === index ? { ...l, accountId: event.target.value } : l,
                          ),
                        )
                      }
                    >
                      <option value="">Select…</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.code}: {account.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label="Debit minor units"
                      inputMode="numeric"
                      value={line.debitMinor}
                      onChange={(event) =>
                        setLines(
                          lines.map((l, i) =>
                            i === index ? { ...l, debitMinor: event.target.value } : l,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label="Credit minor units"
                      inputMode="numeric"
                      value={line.creditMinor}
                      onChange={(event) =>
                        setLines(
                          lines.map((l, i) =>
                            i === index ? { ...l, creditMinor: event.target.value } : l,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="py-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Remove line"
                      onClick={() => setLines(lines.filter((_, i) => i !== index))}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLines([...lines, { accountId: '', debitMinor: '', creditMinor: '' }])}
          >
            <Plus aria-hidden className="size-4" /> Add line
          </Button>

          <div className="flex justify-end border-t pt-3">
            <Button size="sm" disabled={busy} onClick={() => void createTemplate()}>
              <Save aria-hidden className="size-4" /> Create template
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
