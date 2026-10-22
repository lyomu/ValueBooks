'use client';

import type {
  PlatformCountryPack,
  PlatformCountryPackTier,
  PlatformTaxPack,
} from '@valuebooks/contracts';
import {
  Badge,
  Button,
  DataTable,
  DataTableSearch,
  DataTableToolbar,
  DetailSkeleton,
  ErrorState,
  PrimarySecondaryCell,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@valuebooks/ui';
import { CirclePlus, FileJson, LockKeyhole, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { platformRoleAtLeast, usePlatformSession } from '../lib/platform';
import { AdminActionDialog } from './admin-action-dialog';
import { Panel, Row } from './platform-organization-detail';
import { PlatformPage } from './platform-shell';

const REQUIRED_DEFAULT_KEYS = [
  'currency',
  'locale',
  'timeZone',
  'fiscalYearStartMonth',
  'fiscalYearStartDay',
  'chartTemplate',
  'journalPrefix',
  'numberPadding',
  'numberingReset',
] as const;

type EditorMode =
  | { kind: 'create'; source?: PlatformCountryPack }
  | { kind: 'pack'; pack: PlatformCountryPack }
  | { kind: 'tax'; pack: PlatformCountryPack; taxPack?: PlatformTaxPack };

interface DraftForm {
  code: string;
  version: string;
  countryCode: string;
  name: string;
  tier: PlatformCountryPackTier;
  defaults: string;
  notes: string;
  supportedEntityTypes: string;
  includeTax: boolean;
  taxVersion: string;
  taxName: string;
  rates: string;
  registrationFields: string;
  exemptions: string;
  reportingMappings: string;
  taxNotes: string;
}

type JsonObject = Record<string, unknown>;

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseObject(label: string, value: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as JsonObject;
}

function parseObjectArray(label: string, value: string): JsonObject[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
  ) {
    throw new Error(`${label} must be a JSON array of objects.`);
  }
  return parsed as JsonObject[];
}

function formFor(mode: EditorMode): DraftForm {
  const pack = mode.kind === 'create' ? mode.source : mode.pack;
  const taxPack =
    mode.kind === 'tax'
      ? mode.taxPack
      : mode.kind === 'create'
        ? mode.source?.taxPacks[0]
        : undefined;
  const creatingVersion = mode.kind === 'create' && Boolean(mode.source);

  return {
    code: pack?.code ?? '',
    version: creatingVersion ? '' : (pack?.version ?? ''),
    countryCode: pack?.countryCode ?? '',
    name: pack?.name ?? '',
    tier: pack?.tier ?? 'TIER_B_GENERIC',
    defaults: prettyJson(pack?.defaults ?? {}),
    notes: pack?.notes.join('\n') ?? '',
    supportedEntityTypes: pack?.supportedEntityTypes.join(', ') ?? '',
    includeTax: mode.kind === 'tax' || Boolean(taxPack),
    taxVersion: creatingVersion ? '' : (taxPack?.version ?? ''),
    taxName: taxPack?.name ?? (pack ? `${pack.name} tax pack` : ''),
    rates: prettyJson(taxPack?.rates ?? []),
    registrationFields: prettyJson(taxPack?.registrationFields ?? []),
    exemptions: prettyJson(taxPack?.exemptions ?? []),
    reportingMappings: prettyJson(taxPack?.reportingMappings ?? {}),
    taxNotes: taxPack?.notes.join('\n') ?? '',
  };
}

function packPath(pack: PlatformCountryPack): string {
  return `/localization/country-packs/${encodeURIComponent(pack.code)}/versions/${encodeURIComponent(pack.version)}`;
}

/** A version as the admin list returns it: who is pinned to it, and whether new tenants get it. */
type PackVersion = PlatformCountryPack & { pinnedOrganizations: number; current: boolean };
type PackVersionDetail = PackVersion & {
  versions: Array<{
    id: string;
    version: string;
    status: PlatformCountryPack['status'];
    current: boolean;
    publishedAt: string | null;
    pinnedOrganizations: number;
  }>;
  history: Array<{
    id: string;
    eventKey: string;
    reason: string | null;
    occurredAt: string;
    actor: string;
  }>;
};
type CountryName = { code: string; name: string };

/** `ZZ` is the generic fallback: never a jurisdiction, never a compliance claim. */
const FALLBACK_COUNTRY = 'ZZ';
const TIER_EXPLANATION: Record<PlatformCountryPackTier, string> = {
  TIER_A_REVIEWED: 'Reviewed for this jurisdiction. Counts as fully reviewed only while published.',
  TIER_B_GENERIC: 'Generic configuration. Not reviewed for this jurisdiction.',
  TIER_C_BLOCKED: 'Blocked. Compliance-sensitive tax setup is refused for organizations on it.',
};
const DEFAULT_LABEL: Record<string, string> = {
  currency: 'Currency',
  locale: 'Locale',
  timeZone: 'Time zone',
  fiscalYearStartMonth: 'Fiscal year starts (month)',
  fiscalYearStartDay: 'Fiscal year starts (day)',
  chartTemplate: 'Chart of accounts template',
  journalPrefix: 'Journal prefix',
  numberPadding: 'Number padding',
  numberingReset: 'Numbering resets',
};

const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';
const scalar = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : value === null || value === undefined
      ? '—'
      : JSON.stringify(value);
const readable = (key: string) => {
  const text = key.replaceAll('.', ' ').replaceAll('_', ' ');
  return `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
};
const versionHref = (pack: { code: string; version: string }) =>
  `/platform/country-packs/${encodeURIComponent(pack.code)}/${encodeURIComponent(pack.version)}`;

function jurisdiction(countryCode: string, countries: CountryName[] | null) {
  if (countryCode === FALLBACK_COUNTRY) return 'Fallback (no jurisdiction)';
  const name = countries?.find((country) => country.code === countryCode)?.name;
  return name ? `${name} (${countryCode})` : countryCode;
}

/** What is wrong with a version before it can be relied on. Empty means complete. */
function validationIssues(pack: PlatformCountryPack): string[] {
  const issues = REQUIRED_DEFAULT_KEYS.filter((key) => !(key in pack.defaults)).map(
    (key) => `Default "${DEFAULT_LABEL[key] ?? key}" is missing`,
  );
  if (pack.countryCode !== FALLBACK_COUNTRY && pack.taxPacks.length === 0) {
    issues.push('No tax definition');
  }
  return issues;
}

/**
 * The identifier is historical text, the status is the state. A published version whose identifier
 * says "draft" is still published; the UI says so instead of renaming an id documents reference.
 */
function IdentifierNote({ pack }: { pack: Pick<PlatformCountryPack, 'version' | 'status'> }) {
  return /draft/i.test(pack.version) && pack.status !== 'DRAFT' ? (
    <span className="rb-table-secondary">
      &ldquo;draft&rdquo; is part of the identifier; the version is {pack.status.toLowerCase()}.
    </span>
  ) : null;
}

function useCountryNames() {
  const [countries, setCountries] = useState<CountryName[] | null>(null);
  useEffect(() => {
    apiRequest<{ data: { countries: CountryName[] } }>('/organizations/reference-data')
      .then((response) => setCountries(response.data.countries))
      .catch(() => setCountries([]));
  }, []);
  return countries;
}

function SuperadminOnly() {
  return (
    <PlatformPage
      title="Country packs and tax definitions"
      description="Versioned jurisdiction defaults and the tax metadata shipped with them."
    >
      <section className="rb-platform__card rb-platform__forbidden">
        <LockKeyhole aria-hidden="true" />
        <div>
          <h2>Superadmin access required</h2>
          <p className="rb-platform__muted">
            Country packs affect every tenant that adopts them. A superadmin must review and manage
            this catalog.
          </p>
        </div>
      </section>
    </PlatformPage>
  );
}

/** Saves an editor body and reports the server's refusal in place. */
async function saveEditor(
  editor: EditorMode,
  body: Record<string, unknown>,
): Promise<{ code: string; version: string }> {
  const created = await apiRequest<{ data: { code: string; version: string } }>(
    editor.kind === 'create' ? '/localization/country-packs' : packPath(editor.pack),
    { method: editor.kind === 'create' ? 'POST' : 'PATCH', body: JSON.stringify(body) },
  );
  return created.data;
}

type PackGroup = {
  code: string;
  name: string;
  countryCode: string;
  versions: PackVersion[];
  current: PackVersion | null;
  latest: PackVersion;
  pinned: number;
  updatedAt: string;
};

export function PlatformCountryPacks() {
  const router = useRouter();
  const { session } = usePlatformSession();
  const canManage = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');
  const countries = useCountryNames();
  const [packs, setPacks] = useState<PackVersion[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = useCallback(() => {
    if (!canManage) return;
    setError(false);
    apiRequest<{ data: PackVersion[] }>('/localization/country-packs/admin/all')
      .then((response) => setPacks(response.data))
      .catch(() => setError(true));
  }, [canManage]);
  useEffect(() => load(), [load]);

  const groups = useMemo(() => {
    const byCode = new Map<string, PackVersion[]>();
    for (const pack of packs ?? []) byCode.set(pack.code, [...(byCode.get(pack.code) ?? []), pack]);
    const needle = search.trim().toLowerCase();
    return [...byCode.entries()]
      .map(([code, versions]): PackGroup => {
        const current = versions.find((version) => version.current) ?? null;
        const latest = [...versions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]!;
        return {
          code,
          name: (current ?? latest).name,
          countryCode: (current ?? latest).countryCode,
          versions,
          current,
          latest,
          pinned: versions.reduce((sum, version) => sum + version.pinnedOrganizations, 0),
          updatedAt: latest.updatedAt,
        };
      })
      .filter(
        (group) =>
          !needle ||
          group.code.toLowerCase().includes(needle) ||
          group.name.toLowerCase().includes(needle) ||
          jurisdiction(group.countryCode, countries).toLowerCase().includes(needle),
      );
  }, [packs, search, countries]);

  if (!canManage) return <SuperadminOnly />;

  return (
    <PlatformPage
      title="Country packs and tax definitions"
      description="Versioned jurisdiction defaults. A published version is never edited: changes ship as a new version, and each organization stays on the version it was set up with."
      actions={
        <Button
          onClick={() => {
            setSaveError('');
            setEditor({ kind: 'create' });
          }}
        >
          New draft
        </Button>
      }
    >
      {editor ? (
        <>
          {saveError ? (
            <p className="rb-platform__alert" role="alert">
              {saveError}
            </p>
          ) : null}
          <CountryPackEditor
            mode={editor}
            busy={busy}
            onCancel={() => setEditor(null)}
            onSave={async (body) => {
              setBusy(true);
              setSaveError('');
              try {
                const saved = await saveEditor(editor, body);
                router.push(versionHref(saved));
              } catch (caught) {
                setSaveError(
                  caught instanceof ApiError ? caught.message : 'The draft could not be saved.',
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      ) : null}

      {error ? (
        <ErrorState
          title="Country packs could not be loaded"
          description="This is a loading failure, not an empty catalog."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="Country packs"
          toolbar={
            <DataTableToolbar
              resultLabel={
                packs ? `${groups.length} pack${groups.length === 1 ? '' : 's'}` : undefined
              }
            >
              <DataTableSearch
                label="Search country packs"
                placeholder="Code, name or country"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </DataTableToolbar>
          }
          rows={groups.map((group) => ({ ...group, id: group.code }))}
          loading={packs === null}
          emptyTitle={packs?.length ? 'No packs match this search' : 'No country packs yet'}
          columns={[
            {
              key: 'pack',
              header: 'Country pack',
              cell: (group) => (
                <PrimarySecondaryCell
                  primary={
                    <Link href={versionHref(group.current ?? group.latest)}>{group.name}</Link>
                  }
                  secondary={group.code}
                  primaryTitle={group.name}
                />
              ),
            },
            {
              key: 'jurisdiction',
              header: 'Jurisdiction',
              cell: (group) => jurisdiction(group.countryCode, countries),
            },
            {
              key: 'current',
              header: 'Current version',
              cell: (group) =>
                group.current ? (
                  <PrimarySecondaryCell
                    primary={<code>{group.current.version}</code>}
                    secondary={`Published ${dateTime(group.current.publishedAt)}`}
                  />
                ) : (
                  <span className="rb-table-secondary">None published</span>
                ),
            },
            {
              key: 'tier',
              header: 'Review tier',
              cell: (group) => <TierBadge tier={(group.current ?? group.latest).tier} />,
              hideBelow: 'tablet',
            },
            {
              key: 'versions',
              header: 'Versions',
              cell: (group) => versionCounts(group.versions),
              hideBelow: 'tablet',
            },
            {
              key: 'pinned',
              header: 'Organizations',
              align: 'right',
              cell: (group) => group.pinned.toLocaleString(),
            },
            {
              key: 'validation',
              header: 'Validation',
              cell: (group) => {
                const issues = validationIssues(group.current ?? group.latest);
                return issues.length ? (
                  <Badge tone="warning" title={issues.join('; ')}>
                    {issues.length} issue{issues.length === 1 ? '' : 's'}
                  </Badge>
                ) : (
                  <Badge tone="success">Complete</Badge>
                );
              },
              hideBelow: 'tablet',
            },
            {
              key: 'updated',
              header: 'Last change',
              cell: (group) => dateTime(group.updatedAt),
              hideBelow: 'tablet',
            },
          ]}
        />
      )}
      <p className="rb-platform__muted rb-platform__footnote">
        Publishing a pack is not a legal or tax certification. Jurisdiction review and compliance
        ownership sit outside this console.
      </p>
    </PlatformPage>
  );
}

function versionCounts(versions: Array<{ status: PlatformCountryPack['status'] }>) {
  const count = (status: PlatformCountryPack['status']) =>
    versions.filter((version) => version.status === status).length;
  return [
    [count('PUBLISHED'), 'published'],
    [count('DRAFT'), 'draft'],
    [count('DEPRECATED'), 'deprecated'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${n as number} ${label as string}`)
    .join(' · ');
}

function TierBadge({ tier }: { tier: PlatformCountryPackTier }) {
  return (
    <Badge
      tone={
        tier === 'TIER_A_REVIEWED' ? 'success' : tier === 'TIER_C_BLOCKED' ? 'danger' : 'neutral'
      }
      title={TIER_EXPLANATION[tier]}
    >
      {tierLabel(tier)}
    </Badge>
  );
}

type Lifecycle = 'publish' | 'deprecate' | 'delete';

export function PlatformCountryPackVersion({ code, version }: { code: string; version: string }) {
  const router = useRouter();
  const { session } = usePlatformSession();
  const canManage = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');
  const countries = useCountryNames();
  const [pack, setPack] = useState<PackVersionDetail | null>(null);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);

  const load = useCallback(() => {
    if (!canManage) return;
    setError(false);
    apiRequest<{ data: PackVersionDetail }>(
      `/localization/country-packs/admin/${encodeURIComponent(code)}/versions/${encodeURIComponent(version)}`,
    )
      .then((response) => setPack(response.data))
      .catch(() => setError(true));
  }, [canManage, code, version]);
  useEffect(() => load(), [load]);

  if (!canManage) return <SuperadminOnly />;
  const back = <Link href="/platform/country-packs">Back to country packs</Link>;
  if (error) {
    return (
      <PlatformPage title="Country pack" actions={back}>
        <ErrorState
          title="This country pack version could not be loaded"
          description="It may have been a draft that was deleted, or the request failed."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      </PlatformPage>
    );
  }
  if (!pack) {
    return (
      <PlatformPage title="Country pack" actions={back}>
        <DetailSkeleton variant="profile" />
      </PlatformPage>
    );
  }

  const issues = validationIssues(pack);
  const current = pack.versions.find((candidate) => candidate.current) ?? null;
  const otherPublished = pack.versions.filter(
    (candidate) => candidate.status === 'PUBLISHED' && candidate.id !== pack.id,
  );
  const isDraft = pack.status === 'DRAFT';
  const done = (message: string) => {
    setNotice(message);
    setEditor(null);
    load();
  };

  return (
    <PlatformPage
      title={pack.name}
      description={jurisdiction(pack.countryCode, countries)}
      meta={
        <>
          {pack.code} · <code>{pack.version}</code> <IdentifierNote pack={pack} />
        </>
      }
      actions={
        <div className="rb-platform__detail-actions">
          <StatusBadge status={pack.status} />
          {pack.current ? <Badge tone="info">Current for new organizations</Badge> : null}
          {isDraft ? (
            <>
              <Button variant="outline" onClick={() => setEditor({ kind: 'pack', pack })}>
                Edit draft
              </Button>
              <Button onClick={() => setLifecycle('publish')}>Publish</Button>
              <Button variant="ghost" onClick={() => setLifecycle('delete')}>
                Delete draft
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditor({ kind: 'create', source: pack })}>
                Create version from this
              </Button>
              {pack.status === 'PUBLISHED' ? (
                <Button variant="ghost" onClick={() => setLifecycle('deprecate')}>
                  Deprecate
                </Button>
              ) : null}
            </>
          )}
          {back}
        </div>
      }
    >
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}
      {editor ? (
        <>
          {saveError ? (
            <p className="rb-platform__alert" role="alert">
              {saveError}
            </p>
          ) : null}
          <CountryPackEditor
            key={`${editor.kind}-${editor.kind === 'tax' ? (editor.taxPack?.id ?? 'new') : ''}`}
            mode={editor}
            busy={busy}
            onCancel={() => setEditor(null)}
            onSave={async (body, success) => {
              setBusy(true);
              setSaveError('');
              try {
                const saved = await saveEditor(editor, body);
                if (editor.kind === 'create') router.push(versionHref(saved));
                else done(success);
              } catch (caught) {
                setSaveError(
                  caught instanceof ApiError ? caught.message : 'The change could not be saved.',
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      ) : null}

      <Tabs defaultValue="overview" className="rb-platform__tabs">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tax">Tax definitions</TabsTrigger>
          <TabsTrigger value="defaults">Defaults</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="rb-platform__grid">
            <Panel title="Lifecycle">
              <dl>
                <Row label="Status" value={readable(pack.status.toLowerCase())} />
                <Row label="Identifier" value={pack.version} />
                <Row label="Published" value={dateTime(pack.publishedAt)} />
                {pack.deprecatedAt ? (
                  <Row label="Deprecated" value={dateTime(pack.deprecatedAt)} />
                ) : null}
                <Row
                  label="New organizations get"
                  value={
                    pack.current
                      ? 'This version'
                      : current
                        ? `Version ${current.version}`
                        : 'No published version'
                  }
                />
                <Row label="Organizations pinned here" value={pack.pinnedOrganizations} />
                <Row label="Last change" value={dateTime(pack.updatedAt)} />
              </dl>
            </Panel>
            <Panel title="Scope and review">
              <dl>
                <Row label="Jurisdiction" value={jurisdiction(pack.countryCode, countries)} />
                <Row label="Review tier" value={tierLabel(pack.tier)} />
                <Row
                  label="Supported documents"
                  value={
                    pack.supportedEntityTypes.length
                      ? pack.supportedEntityTypes
                          .map((type) => readable(type.toLowerCase()))
                          .join(', ')
                      : '—'
                  }
                />
              </dl>
              <p className="rb-platform__muted">{TIER_EXPLANATION[pack.tier]}</p>
            </Panel>
          </div>
          <Panel title="Validation">
            {issues.length ? (
              <ul className="rb-platform__issue-list">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : (
              <p className="rb-platform__muted">
                Every required default is set and a tax definition is present.
              </p>
            )}
          </Panel>
          {pack.notes.length ? (
            <Panel title="Notes">
              <ul className="rb-platform__issue-list">
                {pack.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </TabsContent>

        <TabsContent value="tax">
          {pack.taxPacks.length === 0 ? (
            <Panel title="Tax definitions">
              <p className="rb-platform__muted">This version carries no tax definition.</p>
            </Panel>
          ) : (
            pack.taxPacks.map((taxPack) => (
              <TaxDefinition
                key={taxPack.id}
                taxPack={taxPack}
                onEdit={isDraft ? () => setEditor({ kind: 'tax', pack, taxPack }) : undefined}
              />
            ))
          )}
          {isDraft ? (
            <div className="rb-platform__actions">
              <Button variant="outline" onClick={() => setEditor({ kind: 'tax', pack })}>
                Add tax version
              </Button>
            </div>
          ) : (
            <p className="rb-platform__muted">
              Published and deprecated versions are read-only. Create a version from this one to
              change rates.
            </p>
          )}
        </TabsContent>

        <TabsContent value="defaults">
          <Panel title="Onboarding defaults">
            <dl>
              {Object.entries(pack.defaults).map(([key, value]) => (
                <Row key={key} label={DEFAULT_LABEL[key] ?? key} value={scalar(value)} />
              ))}
            </dl>
            <p className="rb-platform__muted">
              Applied when an organization is created on this version. Every value stays editable by
              the organization afterwards.
            </p>
          </Panel>
        </TabsContent>

        <TabsContent value="versions">
          <Panel title={`Versions of ${pack.code}`}>
            <DataTable
              caption={`Versions of ${pack.code}`}
              rows={pack.versions}
              columns={[
                {
                  key: 'version',
                  header: 'Identifier',
                  cell: (row) =>
                    row.id === pack.id ? (
                      <code>{row.version}</code>
                    ) : (
                      <Link href={versionHref({ code: pack.code, version: row.version })}>
                        <code>{row.version}</code>
                      </Link>
                    ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (row) => (
                    <>
                      <StatusBadge status={row.status} />{' '}
                      {row.current ? <Badge tone="info">Current</Badge> : null}
                    </>
                  ),
                },
                { key: 'published', header: 'Published', cell: (row) => dateTime(row.publishedAt) },
                {
                  key: 'pinned',
                  header: 'Organizations',
                  align: 'right',
                  cell: (row) => row.pinnedOrganizations.toLocaleString(),
                },
              ]}
            />
          </Panel>
        </TabsContent>

        <TabsContent value="audit">
          <Panel title="Audit">
            <DataTable
              caption="Changes to this version and its tax definitions"
              rows={pack.history}
              emptyTitle="No console changes on record"
              emptyDescription="Seeded versions have no history until someone changes them."
              emptyState={{ variant: 'inline' }}
              columns={[
                {
                  key: 'when',
                  header: 'When',
                  cell: (event) => (
                    <PrimarySecondaryCell
                      primary={dateTime(event.occurredAt)}
                      secondary={event.actor}
                    />
                  ),
                },
                {
                  key: 'action',
                  header: 'Action',
                  cell: (event) => (
                    <span title={event.eventKey}>
                      {readable(event.eventKey.replace(/^platform\.country_pack_/, ''))}
                    </span>
                  ),
                },
                { key: 'reason', header: 'Reason', cell: (event) => event.reason ?? '—' },
              ]}
            />
          </Panel>
        </TabsContent>
      </Tabs>

      {lifecycle === 'publish' ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setLifecycle(null))}
          title={`Publish ${pack.code} ${pack.version}`}
          confirmLabel="Publish version"
          confirmationPhrase={`${pack.code} ${pack.version}`}
          confirmDisabled={issues.some((issue) => issue.startsWith('Default'))}
          impact={
            <>
              <p>
                Locks this version permanently. It becomes the version <strong>new</strong>{' '}
                organizations on {pack.code} receive
                {current ? `, in place of ${current.version}` : ''}. Organizations already on
                another version stay there, and issued documents keep their own snapshot.
              </p>
              {issues.length ? (
                <p>
                  <strong>Validation:</strong> {issues.join('; ')}.
                </p>
              ) : null}
              <p>Publishing is not a legal or tax certification. Tier: {tierLabel(pack.tier)}.</p>
            </>
          }
          onConfirm={async (reason) => {
            await apiRequest(`${packPath(pack)}/publish`, {
              method: 'POST',
              body: JSON.stringify({ reason }),
            });
            done(`${pack.code} ${pack.version} published.`);
          }}
        />
      ) : null}

      {lifecycle === 'deprecate' ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setLifecycle(null))}
          title={`Deprecate ${pack.code} ${pack.version}`}
          confirmLabel="Deprecate version"
          tone="danger"
          impact={
            <>
              <p>
                No new organization will receive this version.{' '}
                {pack.current
                  ? otherPublished.length
                    ? `New organizations get ${otherPublished[0]!.version} instead.`
                    : `No other published version of ${pack.code} remains for new organizations.`
                  : ''}
              </p>
              <p>
                The <strong>{pack.pinnedOrganizations.toLocaleString()}</strong> organization
                {pack.pinnedOrganizations === 1 ? '' : 's'} pinned here stay on it, and their
                documents are unchanged.
                {pack.tier === 'TIER_A_REVIEWED'
                  ? ' A deprecated Tier A version no longer counts as fully reviewed for them.'
                  : ''}{' '}
                Deprecation cannot be undone; ship a new version instead.
              </p>
            </>
          }
          onConfirm={async (reason) => {
            await apiRequest(`${packPath(pack)}/deprecate`, {
              method: 'POST',
              body: JSON.stringify({ reason }),
            });
            done(`${pack.code} ${pack.version} deprecated.`);
          }}
        />
      ) : null}

      {lifecycle === 'delete' ? (
        <AdminActionDialog
          open
          onOpenChange={(open) => (open ? undefined : setLifecycle(null))}
          title={`Delete draft ${pack.code} ${pack.version}`}
          confirmLabel="Delete draft"
          tone="danger"
          impact={
            <p>
              Deletes this draft and its tax definitions. No organization can be on a draft, so no
              tenant is affected. The deletion stays in the audit log.
            </p>
          }
          onConfirm={async (reason) => {
            await apiRequest(packPath(pack), {
              method: 'DELETE',
              body: JSON.stringify({ reason }),
            });
            router.push('/platform/country-packs');
          }}
        />
      ) : null}
    </PlatformPage>
  );
}

function TaxDefinition({ taxPack, onEdit }: { taxPack: PlatformTaxPack; onEdit?: () => void }) {
  // Rate objects are free-form JSON; the known keys are read and anything else stays visible in
  // the editor.
  const rates = taxPack.rates.map((rate, index): Record<string, unknown> & { id: string } => ({
    ...rate,
    id: String(index),
  }));
  return (
    <Panel title={`${taxPack.name} · ${taxPack.version}`}>
      <dl>
        <Row
          label="Registration fields"
          value={
            taxPack.registrationFields.length
              ? taxPack.registrationFields
                  .map(
                    (field) =>
                      `${scalar(field.label ?? field.key)}${field.required === true ? ' (required)' : ''}`,
                  )
                  .join(', ')
              : '—'
          }
        />
        <Row label="Exemptions" value={taxPack.exemptions.length} />
        <Row label="Reporting mappings" value={Object.keys(taxPack.reportingMappings).length} />
      </dl>
      <DataTable
        caption={`Rates in ${taxPack.name}`}
        rows={rates}
        emptyTitle="No rates"
        emptyDescription="This definition carries no tax rates."
        emptyState={{ variant: 'inline' }}
        columns={[
          { key: 'label', header: 'Rate', cell: (rate) => scalar(rate.label ?? rate.code) },
          {
            key: 'percent',
            header: 'Percent',
            align: 'right',
            cell: (rate) => (rate.ratePercent === undefined ? '—' : `${scalar(rate.ratePercent)}%`),
          },
          {
            key: 'treatment',
            header: 'Treatment',
            cell: (rate) => readable(scalar(rate.treatment).toLowerCase()),
          },
          {
            key: 'recoverable',
            header: 'Recoverable',
            cell: (rate) =>
              rate.recoverable === undefined ? '—' : rate.recoverable === true ? 'Yes' : 'No',
            hideBelow: 'tablet',
          },
        ]}
      />
      {taxPack.notes.length ? (
        <p className="rb-platform__muted">{taxPack.notes.join(' ')}</p>
      ) : null}
      {onEdit ? (
        <div className="rb-platform__actions">
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit tax definition
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

function CountryPackEditor({
  mode,
  busy,
  onCancel,
  onSave,
}: {
  mode: EditorMode;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>, success: string) => Promise<void>;
}) {
  const [form, setForm] = useState(() => formFor(mode));
  const [formError, setFormError] = useState('');
  const isCreate = mode.kind === 'create';
  const isTaxOnly = mode.kind === 'tax';
  const isVersion = mode.kind === 'create' && Boolean(mode.source);
  const title = isVersion
    ? `Create a version from ${mode.source?.code} ${mode.source?.version}`
    : mode.kind === 'pack'
      ? `Edit ${mode.pack.code} ${mode.pack.version}`
      : mode.kind === 'tax'
        ? `${mode.taxPack ? 'Edit' : 'Add'} tax definition for ${mode.pack.code} ${mode.pack.version}`
        : 'Create country pack draft';

  function update<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setFormError('');
    try {
      const taxPack = form.includeTax
        ? {
            version: form.taxVersion.trim(),
            name: form.taxName.trim(),
            rates: parseObjectArray('Rates', form.rates),
            registrationFields: parseObjectArray('Registration fields', form.registrationFields),
            exemptions: parseObjectArray('Exemptions', form.exemptions),
            reportingMappings: parseObject('Reporting mappings', form.reportingMappings),
            notes: splitList(form.taxNotes),
          }
        : undefined;

      if (form.includeTax && (!taxPack?.version || !taxPack.name)) {
        throw new Error('Tax version and name are required.');
      }

      if (isTaxOnly) {
        await onSave(
          { taxPack },
          `${form.code} ${form.version} tax definition ${form.taxVersion.trim()} saved.`,
        );
        return;
      }

      const defaults = parseObject('Defaults', form.defaults);
      const missing = REQUIRED_DEFAULT_KEYS.filter((key) => !(key in defaults));
      if (missing.length > 0) {
        throw new Error(`Defaults are missing required keys: ${missing.join(', ')}.`);
      }
      if (!form.name.trim()) throw new Error('Pack name is required.');

      if (isCreate) {
        if (!form.code.trim() || !form.version.trim() || !form.countryCode.trim()) {
          throw new Error('Pack code, version, and country code are required.');
        }
        await onSave(
          {
            code: form.code.trim().toUpperCase(),
            version: form.version.trim(),
            countryCode: form.countryCode.trim().toUpperCase(),
            name: form.name.trim(),
            tier: form.tier,
            defaults,
            notes: splitList(form.notes),
            supportedEntityTypes: splitList(form.supportedEntityTypes).map((value) =>
              value.toUpperCase(),
            ),
            ...(taxPack ? { taxPack } : {}),
          },
          `${form.code.trim().toUpperCase()} ${form.version.trim()} draft created.`,
        );
        return;
      }

      await onSave(
        {
          name: form.name.trim(),
          tier: form.tier,
          defaults,
          notes: splitList(form.notes),
          supportedEntityTypes: splitList(form.supportedEntityTypes).map((value) =>
            value.toUpperCase(),
          ),
        },
        `${form.code} ${form.version} updated.`,
      );
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'The form could not be read.');
    }
  }

  return (
    <section className="rb-platform__card rb-platform__editor" aria-labelledby="pack-editor-title">
      <div className="rb-platform__card-head">
        <div>
          <h2 id="pack-editor-title">{title}</h2>
          <p className="rb-platform__muted">
            {isTaxOnly
              ? 'Tax metadata is versioned under this draft. Saving a matching version updates it in place.'
              : 'Published versions stay immutable. Use Create version when live defaults need to change.'}
          </p>
        </div>
        <button
          type="button"
          className="is-secondary rb-platform__close"
          aria-label="Close editor"
          disabled={busy}
          onClick={onCancel}
        >
          <X aria-hidden="true" />
        </button>
      </div>

      {formError ? (
        <p className="rb-platform__alert" role="alert">
          {formError}
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {!isTaxOnly ? (
          <>
            <div className="rb-platform__form-grid">
              <label>
                Pack code
                <input
                  value={form.code}
                  readOnly={isVersion || mode.kind === 'pack'}
                  minLength={2}
                  maxLength={8}
                  placeholder="KE"
                  onChange={(event) =>
                    update('code', event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                />
              </label>
              <label>
                Pack version
                <input
                  value={form.version}
                  readOnly={mode.kind === 'pack'}
                  maxLength={24}
                  placeholder="2026.2"
                  onChange={(event) => update('version', event.target.value)}
                />
              </label>
              <label>
                Country code
                <input
                  value={form.countryCode}
                  readOnly={isVersion || mode.kind === 'pack'}
                  minLength={2}
                  maxLength={2}
                  placeholder="KE"
                  onChange={(event) =>
                    update('countryCode', event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))
                  }
                />
              </label>
              <label>
                Review tier
                <select
                  value={form.tier}
                  onChange={(event) =>
                    update('tier', event.target.value as PlatformCountryPackTier)
                  }
                >
                  <option value="TIER_A_REVIEWED">Tier A - reviewed</option>
                  <option value="TIER_B_GENERIC">Tier B - generic</option>
                  <option value="TIER_C_BLOCKED">Tier C - blocked</option>
                </select>
              </label>
              <label className="rb-platform__field-wide">
                Pack name
                <input
                  value={form.name}
                  minLength={2}
                  maxLength={120}
                  onChange={(event) => update('name', event.target.value)}
                />
              </label>
              <label className="rb-platform__field-wide">
                Supported entity types
                <input
                  value={form.supportedEntityTypes}
                  placeholder="INVOICE, CREDIT_NOTE, BILL, EXPENSE"
                  onChange={(event) => update('supportedEntityTypes', event.target.value)}
                />
              </label>
              <JsonField
                label="Defaults"
                value={form.defaults}
                hint={`Required keys: ${REQUIRED_DEFAULT_KEYS.join(', ')}`}
                onChange={(value) => update('defaults', value)}
              />
              <label className="rb-platform__field-wide">
                Pack notes
                <textarea
                  value={form.notes}
                  rows={3}
                  placeholder="One note per line"
                  onChange={(event) => update('notes', event.target.value)}
                />
              </label>
            </div>

            {isCreate ? (
              <label className="rb-platform__check rb-platform__tax-toggle">
                <input
                  type="checkbox"
                  checked={form.includeTax}
                  onChange={(event) => update('includeTax', event.target.checked)}
                />
                Include a tax definition in this draft
              </label>
            ) : null}
          </>
        ) : null}

        {form.includeTax ? (
          <fieldset className="rb-platform__fieldset">
            <legend>Tax definition</legend>
            <div className="rb-platform__form-grid">
              <label>
                Tax version
                <input
                  value={form.taxVersion}
                  readOnly={mode.kind === 'tax' && Boolean(mode.taxPack)}
                  maxLength={24}
                  placeholder={form.version || '2026.2'}
                  onChange={(event) => update('taxVersion', event.target.value)}
                />
              </label>
              <label>
                Tax definition name
                <input
                  value={form.taxName}
                  minLength={2}
                  maxLength={120}
                  onChange={(event) => update('taxName', event.target.value)}
                />
              </label>
              <JsonField
                label="Rates"
                value={form.rates}
                hint="JSON array of rate objects"
                onChange={(value) => update('rates', value)}
              />
              <JsonField
                label="Registration fields"
                value={form.registrationFields}
                hint="JSON array of field definitions"
                onChange={(value) => update('registrationFields', value)}
              />
              <JsonField
                label="Exemptions"
                value={form.exemptions}
                hint="JSON array of exemption definitions"
                onChange={(value) => update('exemptions', value)}
              />
              <JsonField
                label="Reporting mappings"
                value={form.reportingMappings}
                hint="JSON object keyed by reporting destination"
                onChange={(value) => update('reportingMappings', value)}
              />
              <label className="rb-platform__field-wide">
                Tax notes
                <textarea
                  value={form.taxNotes}
                  rows={3}
                  placeholder="One note per line"
                  onChange={(event) => update('taxNotes', event.target.value)}
                />
              </label>
            </div>
          </fieldset>
        ) : null}

        <div className="rb-platform__actions">
          <button type="submit" disabled={busy}>
            {isCreate ? <CirclePlus aria-hidden="true" /> : <FileJson aria-hidden="true" />}
            {busy ? 'Saving...' : isCreate ? 'Create draft' : 'Save changes'}
          </button>
          <button type="button" className="is-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

function JsonField({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rb-platform__json-field">
      {label}
      <textarea
        value={value}
        rows={8}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <small>{hint}</small>
    </label>
  );
}

function tierLabel(tier: PlatformCountryPackTier): string {
  if (tier === 'TIER_A_REVIEWED') return 'Tier A - reviewed';
  if (tier === 'TIER_C_BLOCKED') return 'Tier C - blocked';
  return 'Tier B - generic';
}
