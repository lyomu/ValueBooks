'use client';

import type { PlatformAnalytics } from '@valuebooks/contracts';
import { Building2, CheckCircle2, Clock3, ShieldAlert, UserRoundPlus, Users } from 'lucide-react';
import { StatCard } from '@valuebooks/ui';
import { useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import { PlatformPage } from './platform-shell';

/**
 * Platform overview: activation, adoption, retention, and distribution.
 *
 * Every figure is a count of organizations or a percentage of them. Nothing here is money — the
 * API does not return any, by design, so this screen could not display revenue even if asked.
 */
export function PlatformOverview() {
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiRequest<{ data: PlatformAnalytics }>('/platform/analytics')
      .then((response) => setAnalytics(response.data))
      .catch(() => setError('Analytics could not be loaded.'));
  }, []);

  if (error) {
    return (
      <PlatformPage title="Overview">
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      </PlatformPage>
    );
  }
  if (!analytics) {
    return (
      <PlatformPage title="Overview">
        <p className="rb-platform__muted">Loading platform analytics…</p>
      </PlatformPage>
    );
  }

  return (
    <PlatformPage
      title="Overview"
      description={`Platform-wide adoption as at ${new Date(analytics.observedAt).toLocaleString()}.`}
    >
      <section className="rb-platform__section" aria-labelledby="platform-organizations-heading">
        <h2 id="platform-organizations-heading">Organizations</h2>
        <div className="rb-platform__stats">
          <StatCard
            label="Organizations"
            value={analytics.organizations.total.toLocaleString()}
            icon={Building2}
          />
          <StatCard
            label="Active"
            value={analytics.organizations.active.toLocaleString()}
            icon={CheckCircle2}
            tone="success"
          />
          <StatCard
            label="Suspended"
            value={analytics.organizations.suspended.toLocaleString()}
            icon={ShieldAlert}
            tone="warning"
          />
          <StatCard
            label="Still in setup"
            value={analytics.organizations.draft.toLocaleString()}
            icon={Clock3}
            tone="info"
          />
        </div>
      </section>
      <section className="rb-platform__section" aria-labelledby="platform-growth-heading">
        <h2 id="platform-growth-heading">People and growth</h2>
        <div className="rb-platform__stats rb-platform__stats--secondary">
          <StatCard
            label="New organizations in 30 days"
            value={analytics.organizations.createdLast30Days.toLocaleString()}
            icon={UserRoundPlus}
            tone="info"
          />
          <StatCard label="Users" value={analytics.users.total.toLocaleString()} icon={Users} />
        </div>
      </section>

      <div className="rb-platform__grid">
        <section className="rb-platform__card" aria-label="Activation">
          <h2>Activation</h2>
          <dl>
            <Row
              label="Finished onboarding"
              value={`${analytics.activation.onboardingCompleted} (${analytics.activation.onboardingCompletedRate}%)`}
            />
            <Row
              label="Issued a first invoice"
              value={`${analytics.activation.reachedFirstInvoice} (${analytics.activation.reachedFirstInvoiceRate}%)`}
            />
          </dl>
        </section>

        <section className="rb-platform__card" aria-label="Retention">
          <h2>Retention</h2>
          <dl>
            <Row
              label="Active in 30 days"
              value={`${analytics.retention.activeLast30Days} (${analytics.retention.activeLast30DaysRate}% of active)`}
            />
            <Row label="Active in 90 days" value={analytics.retention.activeLast90Days} />
          </dl>
          <p className="rb-platform__muted">
            Measured from audit activity, which every state change writes.
          </p>
        </section>

        <section className="rb-platform__card" aria-label="Module adoption">
          <h2>Module adoption</h2>
          <dl>
            <Row label="Invoicing" value={analytics.adoption.invoicing} />
            <Row label="Banking" value={analytics.adoption.banking} />
            <Row label="Inventory" value={analytics.adoption.inventory} />
            <Row label="Projects" value={analytics.adoption.projects} />
            <Row label="Portals" value={analytics.adoption.portals} />
            <Row label="Automation" value={analytics.adoption.automation} />
          </dl>
        </section>

        <section className="rb-platform__card" aria-label="Plans">
          <h2>By plan</h2>
          <dl>
            {analytics.distribution.byPlan.length === 0 ? (
              <p className="rb-platform__muted">No subscriptions yet.</p>
            ) : (
              analytics.distribution.byPlan.map((row) => (
                <Row key={row.planId} label={row.planName} value={row.organizations} />
              ))
            )}
          </dl>
        </section>

        <section className="rb-platform__card" aria-label="Countries">
          <h2>By country</h2>
          <dl>
            {analytics.distribution.byCountry.slice(0, 10).map((row) => (
              <Row key={row.countryCode} label={row.countryCode} value={row.organizations} />
            ))}
          </dl>
        </section>
      </div>
    </PlatformPage>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rb-platform__row">
      <dt>{label}</dt>
      <dd>{typeof value === 'number' ? value.toLocaleString() : value}</dd>
    </div>
  );
}
