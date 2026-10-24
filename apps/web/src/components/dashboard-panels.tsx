'use client';

import { Card, Skeleton } from '@valuebooks/ui';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Dashboard building blocks shared by the customer dashboard and the Platform Admin overview.
 * Both render the same `rb-dash-*` markup, so a KPI tile or panel looks and behaves the same in
 * either context; only the content differs.
 */

export type DashboardKpiDelta = {
  /** Already formatted, e.g. "+12%" or "+3". */
  label: string;
  /** Whether the change is good news: drives the colour, independent of its sign. */
  favorable: boolean;
};

export function DashboardKpi({
  label,
  icon: Icon,
  value,
  hint,
  loading = false,
  tone,
  delta,
  href,
}: {
  label: string;
  icon: LucideIcon;
  /** Rendered as-is. Pass a dash or "Unavailable" for a failed query -- never a false zero. */
  value: ReactNode;
  hint?: ReactNode;
  loading?: boolean;
  /** Optional value colour modifier (`is-${tone}`), e.g. income / expense / profit. */
  tone?: string;
  delta?: DashboardKpiDelta | null;
  /** Makes the whole tile a drilldown into the filtered records behind the number. */
  href?: string;
}) {
  const body = (
    <>
      <div className="rb-dash-kpi-top">
        <span>{label}</span>
        <Icon aria-hidden="true" />
      </div>
      <strong>{loading ? 'Loading…' : value}</strong>
      <small>
        {!loading && delta ? (
          <span
            className={delta.favorable ? 'rb-dash-kpi__delta is-up' : 'rb-dash-kpi__delta is-down'}
          >
            {delta.label}
          </span>
        ) : null}
        {loading ? ' ' : hint}
      </small>
    </>
  );
  const className = ['rb-dash-kpi', tone ? `is-${tone}` : '', href ? 'is-link' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <Card className={className}>
      {href ? (
        <Link href={href} className="rb-dash-kpi__link">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

export function DashboardPanelHeading({
  title,
  description,
  href,
  linkLabel = 'View all',
}: {
  title: string;
  description?: ReactNode;
  href?: string | null;
  linkLabel?: string;
}) {
  return (
    <div className="rb-dash-panel-heading">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {href ? (
        <Link href={href}>
          {linkLabel} <ArrowUpRight aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

export function ChartLegend({ items, colors }: { items: string[]; colors: string[] }) {
  return (
    <div className="rb-dash-legend">
      {items.map((item, index) => (
        <span key={item}>
          <i style={{ background: colors[index] }} />
          {item}
        </span>
      ))}
    </div>
  );
}

export function ChartLoading({ label = 'Loading dashboard data' }: { label?: string }) {
  return (
    <div className="rb-dash-loading" aria-label={label}>
      <Skeleton />
      <Skeleton />
    </div>
  );
}
