import { AlertTriangle, Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from './utils';

export type EmptyStateVariant = 'onboarding' | 'inline' | 'no-results';
export type EmptyStateIllustration = 'sales' | 'purchases' | 'inventory' | 'accounting' | 'banking' | 'administration';

export type EmptyStateConfig = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  illustration?: EmptyStateIllustration;
  variant?: EmptyStateVariant;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  benefits?: readonly string[];
  className?: string;
};

function inferIllustration(title: string, description = ''): EmptyStateIllustration {
  const content = `${title} ${description}`.toLowerCase();
  if (/(vendor|bill|expense|purchase|payable)/.test(content)) return 'purchases';
  if (/(item|catalog|stock|warehouse|reorder|valuation|transfer|adjustment)/.test(content)) return 'inventory';
  if (/(journal|ledger|account|tax|period|balance|currency)/.test(content)) return 'accounting';
  if (/(bank|statement|reconciliation|transfer)/.test(content)) return 'banking';
  if (/(customer|invoice|quote|estimate|sales|payment|credit note|receivable)/.test(content)) return 'sales';
  return 'administration';
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  illustration,
  variant,
  action,
  secondaryAction,
  benefits,
  className,
}: EmptyStateConfig) {
  const domain = illustration ?? inferIllustration(title, description);
  const resolvedVariant = variant ?? (/\b(match|nothing|caught up|overdue|failed|review)\b/i.test(`${title} ${description ?? ''}`) ? 'no-results' : 'onboarding');
  return (
    <section className={cn('rb-empty-state', `rb-empty-state--${resolvedVariant}`, className)} aria-label={title}>
      {resolvedVariant === 'onboarding' ? <span className={`rb-empty-state__illustration rb-empty-state__illustration--${domain}`} aria-hidden="true" /> : null}
      {resolvedVariant !== 'onboarding' ? <span className="rb-empty-state__icon"><Icon aria-hidden="true" /></span> : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action || secondaryAction ? <div className="rb-empty-state__action">{action}{secondaryAction}</div> : null}
      {benefits && benefits.length > 0 ? <ul className="rb-empty-state__benefits">{benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul> : null}
    </section>
  );
}

export function ErrorState({
  title = 'We couldn\'t load this information',
  description = 'Try again. If the problem continues, check your connection.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return <EmptyState icon={AlertTriangle} title={title} description={description} action={action} variant="inline" />;
}
