'use client';

import type {
  ExpenseCategory,
  LedgerAccount,
  RecurringCadence,
  RecurringExpenseTemplate,
  TaxCode,
  Vendor,
} from '@valuebooks/contracts';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@valuebooks/ui';
import { Play, Plus, Save, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';
import { OperationalListing } from './operational-listing';

type TemplateListResponse = { data: RecurringExpenseTemplate[] };
type VendorListResponse = { data: Vendor[] };
type AccountListResponse = { data: LedgerAccount[] };
type TaxCodeListResponse = { data: TaxCode[] };
type CategoryListResponse = { data: ExpenseCategory[] };

const cadenceOptions: readonly RecurringCadence[] = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'];

export function RecurringExpensesPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'purchases.recurring_expenses.view');
  const canManage = hasPermission(organization, 'purchases.recurring_expenses.manage');

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [templates, setTemplates] = useState<RecurringExpenseTemplate[] | null>(null);
  const [editing, setEditing] = useState<RecurringExpenseTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [payeeVendorId, setPayeeVendorId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [cadence, setCadence] = useState<RecurringCadence>('MONTHLY');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [autoCreate, setAutoCreate] = useState(true);
  const [paidThroughAccountId, setPaidThroughAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [taxCodeId, setTaxCodeId] = useState('');
  const [amount, setAmount] = useState('');

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [vendorResponse, accountResponse, taxCodeResponse, categoryResponse, templateResponse] =
        await Promise.all([
          apiRequest<VendorListResponse>(`/organizations/${organizationId}/vendors?status=ACTIVE`),
          apiRequest<AccountListResponse>(`/organizations/${organizationId}/accounts`),
          apiRequest<TaxCodeListResponse>(`/organizations/${organizationId}/tax/codes`),
          apiRequest<CategoryListResponse>(`/organizations/${organizationId}/expense-categories`),
          apiRequest<TemplateListResponse>(`/organizations/${organizationId}/recurring-expenses`),
        ]);
      setVendors(vendorResponse.data);
      setAccounts(accountResponse.data.filter((account) => account.status === 'ACTIVE'));
      setTaxCodes(taxCodeResponse.data.filter((code) => code.status === 'ACTIVE'));
      setCategories(categoryResponse.data.filter((category) => category.active));
      setTemplates(templateResponse.data);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Recurring expenses could not be loaded.',
      );
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currency = organization?.baseCurrency ?? 'KES';

  function resetForm() {
    setPayeeVendorId('');
    setPayeeName('');
    setCadence('MONTHLY');
    setStartDate(new Date().toISOString().slice(0, 10));
    setEndDate('');
    setAutoCreate(true);
    setPaidThroughAccountId('');
    setCategoryId('');
    setTaxCodeId('');
    setAmount('');
  }

  function openCreate() {
    resetForm();
    setEditing(null);
    setShowCreate(true);
  }

  function openEdit(template: RecurringExpenseTemplate) {
    setEditing(template);
    setShowCreate(false);
    setPayeeVendorId(template.payeeVendorId ?? '');
    setPayeeName(template.payeeName ?? '');
    setCadence(template.cadence);
    setEndDate(template.endDate ?? '');
    setAutoCreate(template.autoCreate);
    setPaidThroughAccountId(template.paidThroughAccountId);
    setCategoryId(template.categoryId ?? '');
    setTaxCodeId(template.taxCodeId ?? '');
    setAmount(minorToDecimal(template.amountMinor));
  }

  function closeForm() {
    setEditing(null);
    setShowCreate(false);
  }

  async function submit() {
    if (!organizationId) return;
    if (!payeeVendorId && !payeeName) {
      setError('Choose a vendor or enter a payee name.');
      return;
    }
    setBusy('save');
    setError(null);
    try {
      const payload = {
        payeeVendorId: payeeVendorId || undefined,
        payeeName: payeeVendorId ? undefined : payeeName || undefined,
        cadence,
        startDate,
        endDate: endDate || undefined,
        autoCreate,
        paidThroughAccountId,
        categoryId: categoryId || undefined,
        taxCodeId: taxCodeId || undefined,
        amountMinor: decimalToMinor(amount || '0'),
      };
      if (editing) {
        await apiRequest(`/organizations/${organizationId}/recurring-expenses/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setNotice('Template updated.');
      } else {
        await apiRequest(`/organizations/${organizationId}/recurring-expenses`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setNotice('Template created.');
      }
      closeForm();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The template could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  async function setActive(template: RecurringExpenseTemplate, active: boolean) {
    if (!organizationId) return;
    setError(null);
    try {
      const action = active ? 'reactivate' : 'deactivate';
      await apiRequest(
        `/organizations/${organizationId}/recurring-expenses/${template.id}/${action}`,
        { method: 'POST' },
      );
      setNotice(`Template ${active ? 'reactivated' : 'deactivated'}.`);
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The template status could not be changed.',
      );
    }
  }

  async function runDueTemplates() {
    if (!organizationId) return;
    setBusy('run-due');
    setError(null);
    try {
      const response = await apiRequest<{
        data: { templateId: string; expenseId: string | null }[];
      }>(`/organizations/${organizationId}/recurring-expenses/run-due`, { method: 'POST' });
      setNotice(`Generated ${response.data.length} expense(s) from due templates.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Due templates could not be run.');
    } finally {
      setBusy(null);
    }
  }

  const columns: readonly DataTableColumn<RecurringExpenseTemplate>[] = [
    {
      key: 'payee',
      header: 'Payee',
      value: (template) => template.payeeVendorName ?? template.payeeName ?? '',
      cell: (template) => template.payeeVendorName ?? template.payeeName ?? '—',
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      value: (template) => template.amountMinor,
      cell: (template) => formatMinor(template.amountMinor, currency),
    },
    {
      key: 'cadence',
      header: 'Cadence',
      value: (template) => template.cadence,
      cell: (template) => template.cadence,
    },
    {
      key: 'nextRun',
      header: 'Next run',
      value: (template) => template.nextRunDate,
      cell: (template) => template.nextRunDate,
    },
    {
      key: 'status',
      header: 'Status',
      value: (template) => (template.active ? 'ACTIVE' : 'INACTIVE'),
      cell: (template) => <StatusBadge status={template.active ? 'ACTIVE' : 'INACTIVE'} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (template) =>
        canManage ? (
          <div className="rb-inline-actions">
            <Button variant="ghost" size="sm" onClick={() => openEdit(template)}>
              Edit
            </Button>
            {template.active ? (
              <Button variant="ghost" size="sm" onClick={() => void setActive(template, false)}>
                Deactivate
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => void setActive(template, true)}>
                Reactivate
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant recurring expense access." />
    );
  }

  const formTarget = editing;
  const formOpen = showCreate || Boolean(editing);

  return (
    <>
      <div className="rb-ledger-stack">
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rb-auth-notice" role="status">
            {notice}
          </div>
        ) : null}

        {formOpen ? (
          <Card className="rb-journal-editor">
            <div className="rb-journal-editor__meta">
              <div className="rb-field">
                <Label htmlFor="re-template-vendor">Vendor</Label>
                <Select
                  id="re-template-vendor"
                  value={payeeVendorId}
                  onChange={(event) => setPayeeVendorId(event.target.value)}
                >
                  <option value="">None (free-text payee)</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.displayName}
                    </option>
                  ))}
                </Select>
              </div>
              {!payeeVendorId ? (
                <div className="rb-field">
                  <Label htmlFor="re-template-payee-name">Payee name</Label>
                  <Input
                    id="re-template-payee-name"
                    value={payeeName}
                    maxLength={160}
                    onChange={(event) => setPayeeName(event.target.value)}
                  />
                </div>
              ) : null}
              <div className="rb-field">
                <Label htmlFor="re-template-cadence">Cadence</Label>
                <Select
                  id="re-template-cadence"
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
              <div className="rb-field">
                <Label htmlFor="re-template-start-date">Start date</Label>
                <Input
                  id="re-template-start-date"
                  type="date"
                  value={startDate}
                  disabled={Boolean(formTarget)}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="re-template-end-date">End date (optional)</Label>
                <Input
                  id="re-template-end-date"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="re-template-paid-through">Paid through</Label>
                <Select
                  id="re-template-paid-through"
                  value={paidThroughAccountId}
                  onChange={(event) => setPaidThroughAccountId(event.target.value)}
                >
                  <option value="">Choose account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} {account.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rb-field">
                <Label htmlFor="re-template-category">Category</Label>
                <Select
                  id="re-template-category"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">Default expense account</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rb-field">
                <Label htmlFor="re-template-tax">Tax</Label>
                <Select
                  id="re-template-tax"
                  value={taxCodeId}
                  onChange={(event) => setTaxCodeId(event.target.value)}
                >
                  <option value="">No tax</option>
                  {taxCodes.map((code) => (
                    <option key={code.id} value={code.id}>
                      {code.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rb-field">
                <Label htmlFor="re-template-amount">Amount</Label>
                <Input
                  id="re-template-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="re-template-auto-create">
                  <input
                    id="re-template-auto-create"
                    type="checkbox"
                    checked={autoCreate}
                    onChange={(event) => setAutoCreate(event.target.checked)}
                  />{' '}
                  Auto-post when due (otherwise leaves a draft for review)
                </Label>
              </div>
            </div>

            <div className="rb-dialog-footer">
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void submit()}
                loading={busy === 'save'}
                disabled={!paidThroughAccountId || !amount}
              >
                <Save aria-hidden="true" /> Save template
              </Button>
            </div>
          </Card>
        ) : null}

        {!templates && !error ? (
          <Skeleton />
        ) : (
          <OperationalListing
            title="All recurring expenses"
            rows={templates ?? []}
            columns={columns}
            searchText={(template) =>
              `${template.payeeVendorName ?? ''} ${template.payeeName ?? ''} ${template.cadence} ${template.nextRunDate} ${template.active ? 'active' : 'inactive'}`
            }
            primaryAction={
              canManage ? (
                <div className="rb-inline-actions">
                  <Button
                    variant="outline"
                    onClick={() => void runDueTemplates()}
                    loading={busy === 'run-due'}
                  >
                    <Play aria-hidden="true" /> Run due
                  </Button>
                  <Button onClick={openCreate}>
                    <Plus aria-hidden="true" /> New
                  </Button>
                </div>
              ) : null
            }
            onRefresh={() => void load()}
            importEnabled={false}
            emptyState={{
              title: 'Create. Set. Repeat.',
              description: 'Schedule expenses once, then let ValueBooks create them when they are due.',
              illustration: 'purchases',
              variant: 'onboarding',
              benefits: [
                'Set the payee, category, cadence, and payment account.',
                'Review draft expenses or post them automatically when due.',
              ],
            }}
            noResultsState={{
              title: 'No recurring expenses match this view',
              description: 'Try a different search term or clear the active filters.',
              variant: 'no-results',
            }}
          />
        )}
      </div>
    </>
  );
}

function decimalToMinor(value: string, scale = 2): string {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return '0';
  const [whole = '0', fraction = ''] = normalized.split('.');
  return `${whole}${fraction.padEnd(scale, '0').slice(0, scale)}`.replace(/^0+(?=\d)/, '');
}

function minorToDecimal(value: string): string {
  const amount = BigInt(value);
  const whole = amount / 100n;
  const cents = amount % 100n;
  return `${whole}.${cents.toString().padStart(2, '0')}`;
}

function formatMinor(value: string, currency: string): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const cents = absolute % 100n;
  const formattedWhole = new Intl.NumberFormat('en-KE').format(Number(whole));
  return `${negative ? '-' : ''}${currency} ${formattedWhole}.${cents.toString().padStart(2, '0')}`;
}
