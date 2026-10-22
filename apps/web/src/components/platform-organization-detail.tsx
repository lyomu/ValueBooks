'use client';

import { describeOrganizationPlan, type SubscriptionStatus } from '@valuebooks/contracts';
import {
  Badge,
  Button,
  Card,
  DataTable,
  DetailSkeleton,
  EmptyState,
  ErrorState,
  PrimarySecondaryCell,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@valuebooks/ui';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import { platformQuery, platformRoleAtLeast, usePlatformSession } from '../lib/platform';
import { AdminActionDialog } from './admin-action-dialog';
import type { OrganizationDetail } from './platform-organizations';
import { PlatformPage } from './platform-shell';

type TenantBilling = {
  id: string;
  status: string;
  billingProvider: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  lastPaymentAt: string | null;
  plan: { name: string };
  usage: Array<{ resourceKey: string; usedCount: number }>;
};
type SecurityEvent = {
  id: string;
  eventKey: string;
  severity: string;
  occurredAt: string;
  userEmail?: string | null;
};
type AuditEvent = {
  id: string;
  eventKey: string;
  reason: string | null;
  occurredAt: string;
  actorEmail: string;
};
type FailedJob = { id: string; handler: string; attempts: number; error: string | null };
/** A side feed keeps "still loading" and "failed" apart from a true empty result. */
type Feed<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };
const LOADING = { status: 'loading' } as const;

/**
 * One tenant, in the order an operator asks about it: what is this, what are we charging, who is
 * in it, what can it do, is anything broken, who changed it, and what may I do about it.
 */
export function PlatformOrganizationDetail({ organizationId }: { organizationId: string }) {
  const { session } = usePlatformSession();
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [billing, setBilling] = useState<Feed<TenantBilling | null>>(LOADING);
  const [security, setSecurity] = useState<Feed<SecurityEvent[]>>(LOADING);
  const [audit, setAudit] = useState<Feed<AuditEvent[]>>(LOADING);
  const [jobs, setJobs] = useState<Feed<FailedJob[]>>(LOADING);
  const [dialog, setDialog] = useState<'suspend' | 'reactivate' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const canOperate = platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ data: OrganizationDetail }>(
        `/platform/organizations/${organizationId}`,
      );
      setDetail(response.data);
      setError('');
    } catch {
      setError('This organization could not be loaded.');
      return;
    }
    // Side panels load independently: one failed feed must not blank the tenant record, and a
    // failure is shown as a failure, never as "nothing recorded".
    const query = platformQuery({ organizationId, pageSize: 10 });
    feed<TenantBilling | null>(`/platform/billing/tenants/${organizationId}`, setBilling);
    feed<SecurityEvent[]>(`/platform/security-events${query}`, setSecurity);
    feed<AuditEvent[]>(`/platform/audit${query}`, setAudit);
    feed<FailedJob[]>(`/platform/jobs/failed${query}`, setJobs);
  }, [organizationId]);

  useEffect(() => void load(), [load]);

  async function act(path: 'suspend' | 'reactivate', reason: string) {
    await apiRequest(`/platform/organizations/${organizationId}/${path}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    setNotice(path === 'suspend' ? 'Organization suspended.' : 'Organization reactivated.');
    await load();
  }

  if (error && !detail) {
    return (
      <PlatformPage title="Organization">
        <ErrorState title="Organization unavailable" description={error} />
      </PlatformPage>
    );
  }
  if (!detail) {
    return (
      <PlatformPage title="Organization">
        <DetailSkeleton variant="profile" />
      </PlatformPage>
    );
  }

  const plan = describeOrganizationPlan({
    planName: detail.entitlements.plan?.name ?? detail.planName,
    planStatus: detail.planStatus ?? null,
    subscriptionStatus:
      (detail.entitlements.subscription?.status as SubscriptionStatus | undefined) ??
      detail.subscriptionStatus,
    complimentary: detail.complimentary,
  });

  return (
    <PlatformPage
      title={detail.name}
      description={`${detail.slug} · ${detail.countryCode} · ${detail.baseCurrency}`}
      meta={
        <>
          Created {new Date(detail.createdAt).toLocaleDateString()} · Owner{' '}
          <Link href={`/platform/users/${detail.owner.id}`}>{detail.owner.email}</Link>
        </>
      }
      actions={
        <div className="rb-platform__detail-actions">
          {/* Tenant lifecycle and subscription are independent dimensions (master plan §8.4). */}
          <StatusBadge status={detail.status} />
          <Badge tone={plan.tone}>{plan.label}</Badge>
        </div>
      }
    >
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}

      {detail.status === 'SUSPENDED' ? (
        <Card className="rb-platform__banner is-warn">
          <AlertTriangle aria-hidden="true" />
          <div>
            <h2>Suspended</h2>
            <p>
              {detail.suspendedReason ?? 'No reason recorded.'}
              {detail.suspendedAt
                ? ` Suspended ${new Date(detail.suspendedAt).toLocaleString()}`
                : ' Recorded before platform administration existed.'}
              {detail.suspendedBy ? ` by ${detail.suspendedBy}.` : '.'} Access is blocked; the
              tenant&apos;s books are unchanged.
            </p>
          </div>
        </Card>
      ) : null}

      <Tabs defaultValue="overview" className="rb-platform__tabs">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="billing">Subscription &amp; billing</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="usage">Usage &amp; entitlements</TabsTrigger>
          <TabsTrigger value="health">Technical health</TabsTrigger>
          <TabsTrigger value="security">Security &amp; audit</TabsTrigger>
          {canOperate ? <TabsTrigger value="admin">Administration</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview">
          <div className="rb-platform__grid">
            <Panel title="Identity">
              <dl>
                <Row label="Legal name" value={detail.legalName} />
                <Row label="Slug" value={detail.slug} />
                <Row label="Country" value={detail.countryCode} />
                <Row label="Base currency" value={detail.baseCurrency} />
                <Row label="Time zone" value={detail.timeZone} />
                <Row label="Locale" value={detail.locale} />
              </dl>
            </Panel>
            <Panel title="Lifecycle">
              <dl>
                <Row label="Tenant status" value={detail.status} />
                <Row label="Subscription" value={plan.label} />
                <Row label="Onboarding step" value={detail.onboardingStep.replaceAll('_', ' ')} />
                <Row
                  label="Setup finished"
                  value={
                    detail.onboardingCompletedAt
                      ? new Date(detail.onboardingCompletedAt).toLocaleDateString()
                      : 'Not finished'
                  }
                />
                <Row label="Active members" value={detail.memberCount} />
                <Row
                  label="Last activity"
                  value={
                    detail.lastActivityAt
                      ? new Date(detail.lastActivityAt).toLocaleString()
                      : 'None recorded'
                  }
                />
              </dl>
              {!detail.onboardingCompletedAt ? (
                <p className="rb-platform__muted">
                  This tenant has not finished setup, so parts of the application are unavailable to
                  it.
                </p>
              ) : null}
            </Panel>
            <Panel title="Adoption">
              <dl>
                <Row label="Issued invoices" value={detail.usage.issuedInvoices} />
                <Row
                  label="First invoice"
                  value={
                    detail.usage.firstInvoiceAt
                      ? new Date(detail.usage.firstInvoiceAt).toLocaleDateString()
                      : '—'
                  }
                />
                <Row label="Bills" value={detail.usage.bills} />
                <Row label="Posted journals" value={detail.usage.postedJournals} />
                <Row label="Reconciliations" value={detail.usage.reconciliations} />
                <Row label="Projects" value={detail.usage.projects} />
                <Row label="Portal users" value={detail.usage.portalUsers} />
              </dl>
              <p className="rb-platform__muted">
                Counts and dates only. The console does not read this tenant&apos;s financial data.
              </p>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="billing">
          <div className="rb-platform__grid">
            <Panel title="Subscription">
              {billing.status === 'loading' ? (
                <DetailSkeleton />
              ) : billing.status === 'error' ? (
                <FeedError what="Billing" onRetry={() => void load()} />
              ) : billing.data ? (
                <>
                  <dl>
                    <Row label="Plan" value={billing.data.plan.name} />
                    <Row label="State" value={plan.label} />
                    <Row
                      label="Provider"
                      value={billing.data.billingProvider ?? 'Cardless trial'}
                    />
                    <Row label="Trial ends" value={dateTime(billing.data.trialEndsAt)} />
                    <Row label="Paid through" value={dateTime(billing.data.currentPeriodEnd)} />
                    <Row label="Last payment" value={dateTime(billing.data.lastPaymentAt)} />
                  </dl>
                  <Link href={`/platform/billing/subscriptions/${billing.data.id}`}>
                    Open subscription, payments and reconciliation
                  </Link>
                </>
              ) : (
                <EmptyState
                  variant="no-results"
                  title="No subscription recorded"
                  description="This organization has never held a trial or paid plan."
                />
              )}
              <p className="rb-platform__muted">
                Paid plan changes require customer checkout and a verified provider payment.
              </p>
            </Panel>
            <Panel title="Support overrides">
              <p className="rb-platform__muted">
                Time-limited entitlement exceptions, approved separately from the plan itself.
              </p>
              {canOperate ? (
                <Link href={`/platform/billing/organizations/${organizationId}/overrides`}>
                  Manage overrides
                </Link>
              ) : (
                <p className="rb-platform__muted">Requires the operations role.</p>
              )}
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="members">
          <DataTable
            caption="Organization members"
            rows={detail.members.map((member) => ({ ...member, id: member.userId }))}
            emptyTitle="No members"
            emptyDescription="Only the owner account exists so far."
            columns={[
              {
                key: 'person',
                header: 'Person',
                cell: (member) => (
                  <PrimarySecondaryCell
                    primary={
                      <Link href={`/platform/users/${member.userId}`}>{member.displayName}</Link>
                    }
                    secondary={member.email}
                    primaryTitle={member.displayName}
                    secondaryTitle={member.email}
                  />
                ),
              },
              { key: 'role', header: 'Organization role', cell: (member) => member.roleName },
              {
                key: 'membership',
                header: 'Membership',
                cell: (member) => <StatusBadge status={member.membershipStatus} />,
              },
              {
                key: 'account',
                header: 'Account',
                cell: (member) => <StatusBadge status={member.userStatus} />,
              },
            ]}
          />
          <p className="rb-platform__muted">
            Organization roles are the tenant&apos;s own. They grant nothing in this console.
          </p>
        </TabsContent>

        <TabsContent value="usage">
          <div className="rb-platform__grid">
            <Panel title="Entitlements">
              {detail.entitlements.entitlements.length === 0 ? (
                <EmptyState
                  variant="no-results"
                  title="No entitlements"
                  description="This plan carries no entitlement rows."
                />
              ) : (
                <dl>
                  {detail.entitlements.entitlements.map((entitlement) => (
                    <Row
                      key={entitlement.key}
                      label={entitlement.key}
                      value={
                        !entitlement.enabled
                          ? 'Not included'
                          : entitlement.limitValue === null
                            ? 'Unlimited'
                            : String(entitlement.limitValue)
                      }
                    />
                  ))}
                </dl>
              )}
            </Panel>
            <Panel title="Current usage">
              {billing.status === 'loading' ? (
                <DetailSkeleton />
              ) : billing.status === 'error' ? (
                <FeedError what="Usage" onRetry={() => void load()} />
              ) : billing.data?.usage.length ? (
                <dl>
                  {billing.data.usage.map((counter) => (
                    <Row
                      key={counter.resourceKey}
                      label={counter.resourceKey}
                      value={counter.usedCount}
                    />
                  ))}
                </dl>
              ) : (
                <EmptyState
                  variant="no-results"
                  title="No metered usage yet"
                  description="Counters appear once the tenant performs a metered action this period."
                />
              )}
            </Panel>
            <Panel title="Feature flags">
              {detail.entitlements.flags.length === 0 ? (
                <EmptyState
                  variant="no-results"
                  title="No active flags"
                  description="Nothing is targeted at this organization."
                />
              ) : (
                <dl>
                  {detail.entitlements.flags.map((flag) => (
                    <Row
                      key={flag.key}
                      label={flag.key}
                      value={`${flag.enabled ? 'On' : 'Off'} · decided by ${flag.decidedBy.toLowerCase()}`}
                    />
                  ))}
                </dl>
              )}
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="health">
          <Panel title="Failed scheduled jobs">
            <p className="rb-platform__muted">
              Scheduled executions for this tenant. Queue-level failures are under Jobs &amp;
              queues.
            </p>
            {jobs.status === 'error' ? (
              <FeedError what="Failed jobs" onRetry={() => void load()} />
            ) : (
              <DataTable
                caption="Failed jobs for this organization"
                loading={jobs.status === 'loading'}
                rows={jobs.status === 'ready' ? jobs.data : []}
                emptyTitle="No failed jobs"
                emptyDescription="Nothing has failed for this tenant."
                columns={[
                  { key: 'handler', header: 'Handler', cell: (job) => job.handler },
                  {
                    key: 'attempts',
                    header: 'Attempts',
                    cell: (job) => job.attempts,
                    align: 'right',
                  },
                  { key: 'error', header: 'Error', cell: (job) => job.error ?? '—' },
                ]}
              />
            )}
            <Link href="/platform/jobs">Open jobs and queues</Link>
          </Panel>
        </TabsContent>

        <TabsContent value="security">
          <div className="rb-platform__grid">
            <Panel title="Security events">
              {security.status === 'error' ? (
                <FeedError what="Security events" onRetry={() => void load()} />
              ) : (
                <DataTable
                  caption="Security events for this organization"
                  loading={security.status === 'loading'}
                  rows={security.status === 'ready' ? security.data : []}
                  emptyTitle="No security events"
                  emptyDescription="Nothing has been recorded for this tenant."
                  columns={[
                    { key: 'event', header: 'Event', cell: (event) => readable(event.eventKey) },
                    {
                      key: 'severity',
                      header: 'Severity',
                      cell: (event) => <StatusBadge status={event.severity} />,
                    },
                    {
                      key: 'when',
                      header: 'When',
                      cell: (event) => new Date(event.occurredAt).toLocaleString(),
                    },
                  ]}
                />
              )}
              <Link href={`/platform/security?organizationId=${organizationId}`}>
                All security events
              </Link>
            </Panel>
            <Panel title="Administrative history">
              {audit.status === 'error' ? (
                <FeedError what="Administrative history" onRetry={() => void load()} />
              ) : (
                <DataTable
                  caption="Platform administration of this organization"
                  loading={audit.status === 'loading'}
                  rows={audit.status === 'ready' ? audit.data : []}
                  emptyTitle="No administrative changes"
                  emptyDescription="No operator has acted on this tenant."
                  columns={[
                    { key: 'action', header: 'Action', cell: (event) => readable(event.eventKey) },
                    { key: 'actor', header: 'Actor', cell: (event) => event.actorEmail },
                    { key: 'reason', header: 'Reason', cell: (event) => event.reason ?? '—' },
                    {
                      key: 'when',
                      header: 'When',
                      cell: (event) => new Date(event.occurredAt).toLocaleString(),
                    },
                  ]}
                />
              )}
              <Link href={`/platform/audit?organizationId=${organizationId}`}>Full audit log</Link>
            </Panel>
          </div>
        </TabsContent>

        {canOperate ? (
          <TabsContent value="admin">
            <Panel title="Tenant access">
              {detail.status === 'SUSPENDED' ? (
                <>
                  <p>
                    Reactivating restores access exactly as it was. Onboarding state decides whether
                    the tenant returns to active or to setup.
                  </p>
                  <Button onClick={() => setDialog('reactivate')}>
                    <ShieldCheck aria-hidden="true" /> Reactivate organization
                  </Button>
                </>
              ) : (
                <>
                  <p>
                    Suspension blocks every member from using the application. It changes no data,
                    cancels no subscription, and is reversible.
                  </p>
                  <Button variant="danger" onClick={() => setDialog('suspend')}>
                    Suspend organization
                  </Button>
                </>
              )}
              <p className="rb-platform__muted">
                Suspension, cancellation, trial expiry and deletion are separate things; this action
                only blocks access.
              </p>
            </Panel>
          </TabsContent>
        ) : null}
      </Tabs>

      <AdminActionDialog
        open={dialog === 'suspend'}
        onOpenChange={(open) => setDialog(open ? 'suspend' : null)}
        title="Suspend organization"
        description={detail.name}
        tone="danger"
        confirmLabel="Suspend organization"
        confirmationPhrase={detail.slug}
        impact={
          <>
            <p>
              Active members of <strong>{detail.name}</strong> (
              {detail.memberCount.toLocaleString()}) lose access to the application immediately.
            </p>
            <p>
              Books, documents and history are untouched. The subscription is not cancelled and
              billing continues. Reactivation restores access exactly as it is now.
            </p>
          </>
        }
        onConfirm={(reason) => act('suspend', reason)}
      />
      <AdminActionDialog
        open={dialog === 'reactivate'}
        onOpenChange={(open) => setDialog(open ? 'reactivate' : null)}
        title="Reactivate organization"
        description={detail.name}
        confirmLabel="Reactivate organization"
        impact={
          <p>
            Members regain access. The tenant returns to active if setup was finished, otherwise to
            setup where it left off.
          </p>
        }
        onConfirm={(reason) => act('reactivate', reason)}
      />
    </PlatformPage>
  );
}

function feed<T>(path: string, set: (value: Feed<T>) => void) {
  set(LOADING);
  apiRequest<{ data: T }>(path)
    .then((result) => set({ status: 'ready', data: result.data }))
    .catch(() => set({ status: 'error' }));
}

function FeedError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <ErrorState
      title={`${what} could not be loaded`}
      description="This is a loading failure, not an empty record."
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="rb-platform__card">
      <h2>{title}</h2>
      {children}
    </Card>
  );
}

export function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rb-platform__row">
      <dt>{label}</dt>
      <dd>{typeof value === 'number' ? value.toLocaleString() : value}</dd>
    </div>
  );
}

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

/** `organization.finalized` → "Organization finalized"; the raw key stays available in detail. */
function readable(key: string): string {
  const text = key.replaceAll('.', ' ').replaceAll('_', ' ');
  return `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
}
