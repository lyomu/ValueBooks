'use client';

import type { FeatureFlag } from '@valuebooks/contracts';
import {
  Badge,
  Button,
  DataTable,
  DataTableFilters,
  DataTableSearch,
  DataTableToolbar,
  DetailSkeleton,
  ErrorState,
  FieldMessage,
  FormCombobox,
  FormField,
  Input,
  Label,
  PrimarySecondaryCell,
  Select,
  StatusBadge,
  Textarea,
} from '@valuebooks/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { platformQuery, platformRoleAtLeast, usePlatformSession } from '../lib/platform';
import { AdminActionDialog } from './admin-action-dialog';
import { Panel, Row } from './platform-organization-detail';
import { PlatformPage } from './platform-shell';

type FlagScope = FeatureFlag['rules'][number]['scope'];
type FlagRule = FeatureFlag['rules'][number];
type FlagChange = {
  id: string;
  eventKey: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  occurredAt: string;
  actor: string;
};
type FlagRow = FeatureFlag & {
  updatedAt: string;
  /** Set when an approval workflow owns the flag's targeting (hosted AI egress). */
  governedBy: string | null;
  lastChange: FlagChange | null;
};
type FlagDetail = Omit<FlagRow, 'lastChange'> & { history: FlagChange[] };
type FlagPreview = {
  enabled: boolean;
  decidedBy: FlagScope | 'DEFAULT' | 'ARCHIVED';
  audience: { countryCode: string | null; planId: string | null; organizationId: string | null };
};
type PlanOption = { id: string; name: string; key: string; status: string };
type CountryOption = { code: string; name: string };

/** Most specific first, the order runtime applies (`entitlements.service.ts`). */
const SCOPE_ORDER: readonly FlagScope[] = ['ORGANIZATION', 'PLAN', 'COUNTRY', 'GLOBAL'];
const SCOPE_LABEL: Record<FlagScope, string> = {
  ORGANIZATION: 'Organization',
  PLAN: 'Plan',
  COUNTRY: 'Country',
  GLOBAL: 'Global',
};
const PRECEDENCE =
  'The most specific matching rule wins: organization, then plan, then country, then global. With no matching rule an organization gets the default.';
const GOVERNED_NOTE: Record<string, string> = {
  HOSTED_AI_EGRESS_APPROVAL:
    'Targeting for this flag is owned by the hosted AI egress approval on each organization. Rules change only when an approval is granted or revoked, never here. Archiving it still switches egress off everywhere.',
};
const KEY_PATTERN = /^[a-z][a-z0-9_.-]*$/;

const dateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
const onOff = (enabled: boolean) => (
  <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'On' : 'Off'}</Badge>
);

function targetLabel(
  rule: Pick<FlagRule, 'scope' | 'countryCode' | 'planName' | 'organizationName'>,
) {
  switch (rule.scope) {
    case 'GLOBAL':
      return 'Every organization';
    case 'COUNTRY':
      return rule.countryCode ?? '—';
    case 'PLAN':
      return rule.planName ?? 'Unknown plan';
    case 'ORGANIZATION':
      return rule.organizationName ?? 'Unknown organization';
  }
}

function targetingSummary(flag: FlagRow) {
  if (!flag.rules.length) return 'Default only';
  const scopes = SCOPE_ORDER.filter((scope) => flag.rules.some((rule) => rule.scope === scope));
  return `${flag.rules.length} rule${flag.rules.length === 1 ? '' : 's'}: ${scopes
    .map((scope) => SCOPE_LABEL[scope].toLowerCase())
    .join(', ')}`;
}

/** A history row in words. Events written before phase 5.1 lack the rule detail and say less. */
function describeChange(event: FlagChange, names: Map<string, string>): string {
  const after = event.after ?? {};
  const before = event.before ?? {};
  const target = (snapshot: Record<string, unknown>) => {
    const scope = snapshot.scope as FlagScope | undefined;
    if (!scope) return 'a rule';
    const id =
      (snapshot.countryCode as string | null) ??
      (snapshot.planId as string | null) ??
      (snapshot.organizationId as string | null);
    const name = id ? (names.get(id) ?? id) : null;
    return `${SCOPE_LABEL[scope]} rule${name ? ` (${name})` : ''}`;
  };
  const state = (value: unknown) => (value === true ? 'on' : value === false ? 'off' : '?');
  switch (event.eventKey) {
    case 'platform.feature_flag_created':
      return `Created, default ${state(after.defaultEnabled)}`;
    case 'platform.feature_flag_updated': {
      const parts: string[] = [];
      if (before.defaultEnabled !== after.defaultEnabled) {
        parts.push(`Default ${state(before.defaultEnabled)} → ${state(after.defaultEnabled)}`);
      }
      if (before.status !== after.status) {
        parts.push(after.status === 'ARCHIVED' ? 'Archived' : 'Restored');
      }
      return parts.join(' · ') || 'Updated';
    }
    case 'platform.feature_flag_rule_set':
      return event.before
        ? `${target(after)}: ${state(before.enabled)} → ${state(after.enabled)}`
        : `Added ${target(after)}: ${state(after.enabled)}`;
    case 'platform.feature_flag_rule_removed':
      return `Removed ${target(before)} (was ${state(before.enabled)})`;
    default:
      return event.eventKey;
  }
}

export function PlatformFeatureFlags() {
  const router = useRouter();
  const { session } = usePlatformSession();
  const canManage = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');
  const [flags, setFlags] = useState<FlagRow[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [targeting, setTargeting] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ key: '', name: '', description: '', defaultEnabled: false });

  const load = useCallback(() => {
    setError(false);
    setFlags(null);
    apiRequest<{ data: FlagRow[] }>('/platform/feature-flags')
      .then((response) => setFlags(response.data))
      .catch(() => setError(true));
  }, []);
  useEffect(() => load(), [load]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (flags ?? []).filter(
      (flag) =>
        (!status || flag.status === status) &&
        (!targeting ||
          (targeting === 'NONE'
            ? flag.rules.length === 0
            : flag.rules.some((rule) => rule.scope === targeting))) &&
        (!needle ||
          flag.key.includes(needle) ||
          flag.name.toLowerCase().includes(needle) ||
          (flag.description ?? '').toLowerCase().includes(needle)),
    );
  }, [flags, search, status, targeting]);

  const keyValid = KEY_PATTERN.test(draft.key.trim()) && draft.key.trim().length <= 60;

  return (
    <PlatformPage
      title="Feature flags"
      description={PRECEDENCE}
      actions={canManage ? <Button onClick={() => setCreating(true)}>Create flag</Button> : null}
    >
      {error ? (
        <ErrorState
          title="Feature flags could not be loaded"
          description="This is a loading failure, not an empty list."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="Feature flags"
          toolbar={
            <DataTableToolbar
              resultLabel={
                flags
                  ? `${shown.length} of ${flags.length} flag${flags.length === 1 ? '' : 's'}`
                  : undefined
              }
            >
              <DataTableSearch
                label="Search flags"
                placeholder="Name, key or description"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <DataTableFilters>
                <Select
                  aria-label="Status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="">Any status</option>
                  <option value="ACTIVE">Active</option>
                  <option value="ARCHIVED">Archived</option>
                </Select>
                <Select
                  aria-label="Targeting"
                  value={targeting}
                  onChange={(event) => setTargeting(event.target.value)}
                >
                  <option value="">Any targeting</option>
                  <option value="NONE">Default only</option>
                  {SCOPE_ORDER.map((scope) => (
                    <option key={scope} value={scope}>
                      Has a {SCOPE_LABEL[scope].toLowerCase()} rule
                    </option>
                  ))}
                </Select>
              </DataTableFilters>
            </DataTableToolbar>
          }
          rows={shown}
          loading={flags === null}
          emptyTitle={flags?.length ? 'No flags match these filters' : 'No feature flags yet'}
          columns={[
            {
              key: 'flag',
              header: 'Flag',
              cell: (flag: FlagRow) => (
                <PrimarySecondaryCell
                  primary={<Link href={`/platform/feature-flags/${flag.id}`}>{flag.name}</Link>}
                  secondary={<code>{flag.key}</code>}
                  primaryTitle={flag.name}
                  secondaryTitle={flag.key}
                />
              ),
            },
            {
              key: 'default',
              header: 'Default',
              cell: (flag: FlagRow) => onOff(flag.defaultEnabled),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (flag: FlagRow) => <StatusBadge status={flag.status} />,
            },
            {
              key: 'targeting',
              header: 'Targeting',
              cell: (flag: FlagRow) =>
                flag.governedBy ? (
                  <Badge tone="info">Approval-governed</Badge>
                ) : (
                  targetingSummary(flag)
                ),
              hideBelow: 'tablet',
            },
            {
              key: 'changed',
              header: 'Last change',
              cell: (flag: FlagRow) =>
                flag.lastChange ? (
                  <PrimarySecondaryCell
                    primary={dateTime(flag.lastChange.occurredAt)}
                    secondary={flag.lastChange.actor}
                  />
                ) : (
                  <span className="rb-table-secondary" title="No console change is on record">
                    Not changed in console
                  </span>
                ),
              hideBelow: 'tablet',
            },
          ]}
        />
      )}

      {creating ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setDraft({ key: '', name: '', description: '', defaultEnabled: false });
            }
          }}
          title="Create feature flag"
          confirmLabel="Create flag"
          confirmDisabled={!keyValid || !draft.name.trim()}
          impact={
            <p>
              Creates the flag with no targeting rules, so every organization gets its default. It
              has no effect until code checks this key. The key cannot be changed later.
            </p>
          }
          fields={
            <>
              <FormField>
                <Label htmlFor="flag-key">Key</Label>
                <Input
                  id="flag-key"
                  value={draft.key}
                  placeholder="inventory.multi_warehouse"
                  onChange={(event) =>
                    setDraft({ ...draft, key: event.target.value.toLowerCase() })
                  }
                />
                <FieldMessage error={Boolean(draft.key) && !keyValid}>
                  Lowercase letters, digits, dots, dashes and underscores; starts with a letter.
                </FieldMessage>
              </FormField>
              <FormField>
                <Label htmlFor="flag-name">Name</Label>
                <Input
                  id="flag-name"
                  value={draft.name}
                  maxLength={120}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </FormField>
              <FormField>
                <Label htmlFor="flag-description">Description</Label>
                <Textarea
                  id="flag-description"
                  value={draft.description}
                  maxLength={500}
                  rows={2}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </FormField>
              <FormField>
                <Label htmlFor="flag-default">Default</Label>
                <Select
                  id="flag-default"
                  value={draft.defaultEnabled ? 'on' : 'off'}
                  onChange={(event) =>
                    setDraft({ ...draft, defaultEnabled: event.target.value === 'on' })
                  }
                >
                  <option value="off">Off</option>
                  <option value="on">On</option>
                </Select>
              </FormField>
            </>
          }
          onConfirm={async (reason) => {
            const created = await apiRequest<{ data: { id: string } }>('/platform/feature-flags', {
              method: 'POST',
              body: JSON.stringify({
                key: draft.key.trim(),
                name: draft.name.trim(),
                ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
                defaultEnabled: draft.defaultEnabled,
                reason,
              }),
            });
            router.push(`/platform/feature-flags/${created.data.id}`);
          }}
        />
      ) : null}
    </PlatformPage>
  );
}

/** Plans and supported countries, for typed rule targets and the simulator. */
function useFlagReference() {
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [countries, setCountries] = useState<CountryOption[] | null>(null);
  useEffect(() => {
    apiRequest<{ data: PlanOption[] }>('/platform/plans')
      .then((response) => setPlans(response.data))
      .catch(() => setPlans([]));
    apiRequest<{ data: { countries: CountryOption[] } }>('/organizations/reference-data')
      .then((response) => setCountries(response.data.countries))
      .catch(() => setCountries([]));
  }, []);
  return { plans, countries };
}

export function PlatformFeatureFlagDetail({ flagId }: { flagId: string }) {
  const { session } = usePlatformSession();
  const canManage = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');
  const reference = useFlagReference();
  const [flag, setFlag] = useState<FlagDetail | null>(null);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<'default' | 'status' | 'rule' | null>(null);
  const [removing, setRemoving] = useState<FlagRule | null>(null);

  const load = useCallback(() => {
    setError(false);
    apiRequest<{ data: FlagDetail }>(`/platform/feature-flags/${flagId}`)
      .then((response) => setFlag(response.data))
      .catch(() => setError(true));
  }, [flagId]);
  useEffect(() => load(), [load]);

  const back = <Link href="/platform/feature-flags">Back to feature flags</Link>;
  if (error) {
    return (
      <PlatformPage title="Feature flag" actions={back}>
        <ErrorState
          title="This feature flag could not be loaded"
          description="This is a loading failure; the flag may still exist."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      </PlatformPage>
    );
  }
  if (!flag) {
    return (
      <PlatformPage title="Feature flag" actions={back}>
        <DetailSkeleton variant="profile" />
      </PlatformPage>
    );
  }

  const governed = flag.governedBy !== null;
  const editable = canManage && !governed;
  const archived = flag.status === 'ARCHIVED';
  const names = new Map<string, string>([
    ...(reference.plans ?? []).map((plan) => [plan.id, plan.name] as const),
    ...(reference.countries ?? []).map((country) => [country.code, country.name] as const),
    ...flag.rules.flatMap((rule) =>
      rule.organizationId && rule.organizationName
        ? [[rule.organizationId, rule.organizationName] as const]
        : [],
    ),
  ]);
  const rules = [...flag.rules].sort(
    (a, b) => SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope),
  );
  const done = (message: string) => {
    setNotice(message);
    load();
  };

  return (
    <PlatformPage
      title={flag.name}
      description={flag.description ?? 'No description.'}
      meta={<code>{flag.key}</code>}
      actions={
        <div className="rb-platform__detail-actions">
          <StatusBadge status={flag.status} />
          {canManage && !governed ? (
            <Button variant="outline" onClick={() => setAction('default')}>
              Turn default {flag.defaultEnabled ? 'off' : 'on'}
            </Button>
          ) : null}
          {canManage ? (
            <Button variant="outline" onClick={() => setAction('status')}>
              {archived ? 'Restore' : 'Archive'}
            </Button>
          ) : null}
          {back}
        </div>
      }
    >
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}
      {governed ? (
        <p className="rb-platform__notice">{GOVERNED_NOTE[flag.governedBy!] ?? flag.governedBy}</p>
      ) : null}

      <div className="rb-platform__grid">
        <Panel title="Flag">
          <dl>
            <Row label="Key" value={flag.key} />
            <Row label="Default" value={flag.defaultEnabled ? 'On' : 'Off'} />
            <Row
              label="Status"
              value={archived ? 'Archived: off for every organization' : 'Active'}
            />
            <Row label="Targeting rules" value={flag.rules.length} />
            <Row label="Last updated" value={dateTime(flag.updatedAt)} />
          </dl>
          <p className="rb-platform__muted">{PRECEDENCE}</p>
        </Panel>
        <FlagSimulator flag={flag} reference={reference} />
      </div>

      <Panel title="Targeting rules">
        <DataTable
          caption="Targeting rules, most specific first"
          rows={rules}
          emptyTitle="No targeting rules"
          emptyDescription={`Every organization gets the default (${flag.defaultEnabled ? 'on' : 'off'}).`}
          emptyState={{ variant: 'inline' }}
          columns={[
            { key: 'scope', header: 'Scope', cell: (rule: FlagRule) => SCOPE_LABEL[rule.scope] },
            {
              key: 'target',
              header: 'Target',
              cell: (rule: FlagRule) =>
                rule.scope === 'ORGANIZATION' && rule.organizationId ? (
                  <Link href={`/platform/organizations/${rule.organizationId}`}>
                    {targetLabel(rule)}
                  </Link>
                ) : rule.scope === 'COUNTRY' && rule.countryCode ? (
                  `${names.get(rule.countryCode) ?? rule.countryCode} (${rule.countryCode})`
                ) : (
                  targetLabel(rule)
                ),
            },
            { key: 'result', header: 'Result', cell: (rule: FlagRule) => onOff(rule.enabled) },
            {
              key: 'note',
              header: 'Note',
              cell: (rule: FlagRule) => rule.note ?? '—',
              hideBelow: 'tablet',
            },
            ...(editable
              ? [
                  {
                    key: 'actions',
                    header: <span className="rb-visually-hidden">Actions</span>,
                    cell: (rule: FlagRule) => (
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(rule)}>
                        Remove
                      </Button>
                    ),
                    align: 'right' as const,
                  },
                ]
              : []),
          ]}
        />
        {editable ? (
          <div className="rb-platform__actions">
            <Button variant="outline" onClick={() => setAction('rule')}>
              Add or change a rule
            </Button>
          </div>
        ) : null}
      </Panel>

      <Panel title="Change history">
        <DataTable
          caption="Feature flag change history"
          rows={flag.history}
          emptyTitle="No console changes on record"
          emptyDescription="Flags seeded by a migration have no console history until someone changes them."
          emptyState={{ variant: 'inline' }}
          columns={[
            {
              key: 'when',
              header: 'When',
              cell: (event: FlagChange) => (
                <PrimarySecondaryCell
                  primary={dateTime(event.occurredAt)}
                  secondary={event.actor}
                />
              ),
            },
            {
              key: 'change',
              header: 'Change',
              cell: (event: FlagChange) => (
                <span title={event.eventKey}>{describeChange(event, names)}</span>
              ),
            },
            {
              key: 'reason',
              header: 'Reason',
              cell: (event: FlagChange) => event.reason ?? '—',
              hideBelow: 'tablet',
            },
          ]}
        />
      </Panel>

      {action === 'default' ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setAction(null))}
          title={`Turn default ${flag.defaultEnabled ? 'off' : 'on'}`}
          description={flag.key}
          confirmLabel={`Turn default ${flag.defaultEnabled ? 'off' : 'on'}`}
          tone={flag.defaultEnabled ? 'danger' : 'primary'}
          impact={
            <p>
              Changes the answer for every organization that no rule matches, immediately.
              {flag.rules.length
                ? ` The ${flag.rules.length} targeting rule${flag.rules.length === 1 ? '' : 's'} keep${flag.rules.length === 1 ? 's' : ''} deciding for the organizations they match.`
                : ' This flag has no rules, so this changes it for every organization.'}{' '}
              To undo, turn the default back.
            </p>
          }
          onConfirm={async (reason) => {
            await apiRequest(`/platform/feature-flags/${flag.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ defaultEnabled: !flag.defaultEnabled, reason }),
            });
            done(`Default is now ${flag.defaultEnabled ? 'off' : 'on'}.`);
          }}
        />
      ) : null}

      {action === 'status' ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setAction(null))}
          title={archived ? 'Restore flag' : 'Archive flag'}
          description={flag.key}
          confirmLabel={archived ? 'Restore flag' : 'Archive flag'}
          tone={archived ? 'primary' : 'danger'}
          confirmationPhrase={archived ? undefined : flag.key}
          impact={
            archived ? (
              <p>
                The flag resolves again from its default and rules, exactly as before it was
                archived. Rules were kept while it was archived.
              </p>
            ) : (
              <p>
                An archived flag is <strong>off for every organization</strong>, whatever its
                default and rules say. Rules are kept, so restoring brings back the previous
                behaviour.
              </p>
            )
          }
          onConfirm={async (reason) => {
            await apiRequest(`/platform/feature-flags/${flag.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: archived ? 'ACTIVE' : 'ARCHIVED', reason }),
            });
            done(archived ? 'Flag restored.' : 'Flag archived. It is off everywhere.');
          }}
        />
      ) : null}

      {action === 'rule' ? (
        <RuleDialog
          flag={flag}
          reference={reference}
          onClose={() => setAction(null)}
          onSaved={() => done('Targeting rule saved.')}
        />
      ) : null}

      {removing ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setRemoving(null))}
          title="Remove targeting rule"
          description={`${SCOPE_LABEL[removing.scope]} · ${targetLabel(removing)}`}
          confirmLabel="Remove rule"
          tone="danger"
          impact={
            <p>
              Organizations this rule matched fall back to the next matching rule, or to the default
              ({flag.defaultEnabled ? 'on' : 'off'}). The rule is currently{' '}
              <strong>{removing.enabled ? 'on' : 'off'}</strong>. To undo, add the same rule again.
            </p>
          }
          onConfirm={async (reason) => {
            await apiRequest(`/platform/feature-flags/rules/${removing.id}`, {
              method: 'DELETE',
              body: JSON.stringify({ reason }),
            });
            done('Rule removed.');
          }}
        />
      ) : null}
    </PlatformPage>
  );
}

type Reference = ReturnType<typeof useFlagReference>;

/** A server-side organization search feeding a choice list; tenants are too many to list. */
function OrganizationPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (organizationId: string, name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{
    id: string;
    legalName: string;
    countryCode: string;
  }> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setResults(null);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      apiRequest<{ data: Array<{ id: string; legalName: string; countryCode: string }> }>(
        `/platform/organizations${platformQuery({ query: needle, pageSize: 10 })}`,
      )
        .then((response) => {
          if (current) {
            setFailed(false);
            setResults(response.data);
          }
        })
        .catch(() => current && setFailed(true));
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query]);
  return (
    <>
      <Input
        id={id}
        value={query}
        placeholder="Type at least 2 letters of the name"
        onChange={(event) => setQuery(event.target.value)}
      />
      {results?.length ? (
        <Select
          aria-label="Matching organizations"
          value={value}
          onChange={(event) => {
            const chosen = results.find((row) => row.id === event.target.value);
            onChange(event.target.value, chosen?.legalName ?? '');
          }}
        >
          <option value="">Choose an organization</option>
          {results.map((row) => (
            <option key={row.id} value={row.id}>
              {row.legalName} ({row.countryCode})
            </option>
          ))}
        </Select>
      ) : null}
      <FieldMessage error={failed}>
        {failed
          ? 'Organizations could not be searched. Try again.'
          : results && !results.length
            ? 'No organization matches that name.'
            : 'Searches by legal name.'}
      </FieldMessage>
    </>
  );
}

function CountryPicker({
  id,
  countries,
  value,
  onChange,
}: {
  id: string;
  countries: CountryOption[] | null;
  value: string;
  onChange: (code: string) => void;
}) {
  return (
    <FormCombobox
      id={id}
      value={value}
      clearable
      disabled={!countries?.length}
      placeholder={countries ? 'Search countries' : 'Loading countries…'}
      options={(countries ?? []).map((country) => ({
        value: country.code,
        label: `${country.name} (${country.code})`,
      }))}
      onChange={onChange}
    />
  );
}

function PlanPicker({
  id,
  plans,
  value,
  onChange,
  optional = false,
}: {
  id: string;
  plans: PlanOption[] | null;
  value: string;
  onChange: (planId: string) => void;
  optional?: boolean;
}) {
  return (
    <Select
      id={id}
      value={value}
      disabled={!plans}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">
        {plans ? (optional ? 'No plan' : 'Choose a plan') : 'Loading plans…'}
      </option>
      {(plans ?? []).map((plan) => (
        <option key={plan.id} value={plan.id}>
          {plan.name}
          {plan.status === 'ACTIVE' ? '' : ` (${plan.status.toLowerCase()})`} · {plan.key}
        </option>
      ))}
    </Select>
  );
}

function RuleDialog({
  flag,
  reference,
  onClose,
  onSaved,
}: {
  flag: FlagDetail;
  reference: Reference;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [scope, setScope] = useState<FlagScope>('COUNTRY');
  const [countryCode, setCountryCode] = useState('');
  const [planId, setPlanId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [audience, setAudience] = useState<number | 'loading' | 'failed' | null>(null);

  const target =
    scope === 'COUNTRY'
      ? { countryCode }
      : scope === 'PLAN'
        ? { planId }
        : scope === 'ORGANIZATION'
          ? { organizationId }
          : {};
  const targetChosen = scope === 'GLOBAL' || Object.values(target).every(Boolean);
  const existing = flag.rules.find(
    (rule) =>
      rule.scope === scope &&
      (scope === 'GLOBAL' ||
        (scope === 'COUNTRY' && rule.countryCode === countryCode) ||
        (scope === 'PLAN' && rule.planId === planId) ||
        (scope === 'ORGANIZATION' && rule.organizationId === organizationId)),
  );
  const query = platformQuery({
    scope,
    countryCode,
    planId,
    organizationId: scope === 'ORGANIZATION' ? organizationId : '',
  });

  useEffect(() => {
    if (!targetChosen) {
      setAudience(null);
      return;
    }
    let current = true;
    setAudience('loading');
    apiRequest<{ data: { organizations: number } }>(`/platform/feature-flags/audience${query}`)
      .then((response) => current && setAudience(response.data.organizations))
      .catch(() => current && setAudience('failed'));
    return () => {
      current = false;
    };
  }, [query, targetChosen]);

  return (
    <AdminActionDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Add or change a targeting rule"
      description={flag.key}
      confirmLabel={existing ? 'Change rule' : 'Add rule'}
      confirmDisabled={!targetChosen || (existing ? existing.enabled === enabled : false)}
      impact={
        <>
          <p>
            {audience === null
              ? 'Choose a target to see how many organizations it matches.'
              : audience === 'loading'
                ? 'Counting matching organizations…'
                : audience === 'failed'
                  ? 'The matching organizations could not be counted. The rule can still be saved.'
                  : `This target matches ${audience.toLocaleString()} organization${audience === 1 ? '' : 's'} today.`}{' '}
            A more specific rule still wins for the organizations it matches. The change applies
            immediately.
          </p>
          {existing ? (
            <p>
              Replaces the existing {SCOPE_LABEL[scope].toLowerCase()} rule, which is currently{' '}
              <strong>{existing.enabled ? 'on' : 'off'}</strong>
              {existing.enabled === enabled ? ', so choose the other result.' : '.'}
            </p>
          ) : null}
        </>
      }
      fields={
        <>
          <FormField>
            <Label htmlFor="rule-scope">Scope</Label>
            <Select
              id="rule-scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as FlagScope)}
            >
              {SCOPE_ORDER.map((option) => (
                <option key={option} value={option}>
                  {SCOPE_LABEL[option]}
                </option>
              ))}
            </Select>
          </FormField>
          {scope === 'COUNTRY' ? (
            <FormField>
              <Label htmlFor="rule-country">Country</Label>
              <CountryPicker
                id="rule-country"
                countries={reference.countries}
                value={countryCode}
                onChange={setCountryCode}
              />
            </FormField>
          ) : scope === 'PLAN' ? (
            <FormField>
              <Label htmlFor="rule-plan">Plan</Label>
              <PlanPicker
                id="rule-plan"
                plans={reference.plans}
                value={planId}
                onChange={setPlanId}
              />
            </FormField>
          ) : scope === 'ORGANIZATION' ? (
            <FormField>
              <Label htmlFor="rule-organization">Organization</Label>
              <OrganizationPicker
                id="rule-organization"
                value={organizationId}
                onChange={(id) => setOrganizationId(id)}
              />
            </FormField>
          ) : null}
          <FormField>
            <Label htmlFor="rule-result">Result for matching organizations</Label>
            <Select
              id="rule-result"
              value={enabled ? 'on' : 'off'}
              onChange={(event) => setEnabled(event.target.value === 'on')}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </Select>
          </FormField>
        </>
      }
      onConfirm={async (reason) => {
        await apiRequest(`/platform/feature-flags/${flag.id}/rules`, {
          method: 'POST',
          body: JSON.stringify({ scope, ...target, enabled, note: reason, reason }),
        });
        onSaved();
        onClose();
      }}
    />
  );
}

/** Asks the server, which applies the runtime resolver, what an audience would get. */
function FlagSimulator({ flag, reference }: { flag: FlagDetail; reference: Reference }) {
  const [mode, setMode] = useState<'organization' | 'hypothetical'>('organization');
  const [organizationId, setOrganizationId] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(FlagPreview & { label: string }) | null>(null);
  const [error, setError] = useState('');

  const ready = mode === 'organization' ? Boolean(organizationId) : true;
  async function run() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await apiRequest<{ data: FlagPreview }>(
        `/platform/feature-flags/${encodeURIComponent(flag.key)}/preview${platformQuery(
          mode === 'organization' ? { organizationId } : { countryCode, planId },
        )}`,
      );
      const audience = response.data.audience;
      const plan = reference.plans?.find((candidate) => candidate.id === audience.planId);
      const country = reference.countries?.find(
        (candidate) => candidate.code === audience.countryCode,
      );
      setResult({
        ...response.data,
        label: [
          mode === 'organization' ? organizationName : null,
          country ? country.name : (audience.countryCode ?? 'no country'),
          plan ? plan.name : audience.planId ? 'unknown plan' : 'no plan',
        ]
          .filter(Boolean)
          .join(' · '),
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The preview could not be run.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Audience simulator">
      <p className="rb-platform__muted">
        Read-only. Uses the same resolver as runtime and changes nothing.
        {flag.governedBy
          ? ' At runtime this flag also needs an active approval for the organization, which this check does not cover.'
          : ''}
      </p>
      <FormField>
        <Label htmlFor="sim-mode">Audience</Label>
        <Select
          id="sim-mode"
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as typeof mode);
            setResult(null);
          }}
        >
          <option value="organization">A real organization</option>
          <option value="hypothetical">A country and plan</option>
        </Select>
      </FormField>
      {mode === 'organization' ? (
        <FormField>
          <Label htmlFor="sim-organization">Organization</Label>
          <OrganizationPicker
            id="sim-organization"
            value={organizationId}
            onChange={(id, name) => {
              setOrganizationId(id);
              setOrganizationName(name);
            }}
          />
        </FormField>
      ) : (
        <>
          <FormField>
            <Label htmlFor="sim-country">Country</Label>
            <CountryPicker
              id="sim-country"
              countries={reference.countries}
              value={countryCode}
              onChange={setCountryCode}
            />
          </FormField>
          <FormField>
            <Label htmlFor="sim-plan">Plan</Label>
            <PlanPicker
              id="sim-plan"
              plans={reference.plans}
              value={planId}
              onChange={setPlanId}
              optional
            />
          </FormField>
        </>
      )}
      <div className="rb-platform__actions">
        <Button variant="outline" loading={busy} disabled={!ready} onClick={() => void run()}>
          Run preview
        </Button>
      </div>
      {result ? (
        <p className="rb-platform__notice" role="status">
          <strong>{result.enabled ? 'On' : 'Off'}</strong> for {result.label}:{' '}
          {result.decidedBy === 'ARCHIVED'
            ? 'the flag is archived, so it is off everywhere.'
            : result.decidedBy === 'DEFAULT'
              ? 'no rule matches, so the default decides.'
              : `decided by the ${SCOPE_LABEL[result.decidedBy].toLowerCase()} rule.`}
        </p>
      ) : null}
      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}
