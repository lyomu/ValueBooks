import type { HTMLAttributes } from 'react';

import { cn } from './utils';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cn('rb-badge', `rb-badge--${tone}`, className)} {...props} />;
}

const statusTone: Record<string, BadgeTone> = {
  active: 'success',
  approved: 'success',
  balanced: 'success',
  complete: 'success',
  completed: 'success',
  done: 'success',
  fully_allocated: 'success',
  open: 'success',
  paid: 'success',
  posted: 'success',
  archived: 'neutral',
  draft: 'neutral',
  inactive: 'neutral',
  not_received: 'neutral',
  void: 'neutral',
  in_progress: 'info',
  invoiced: 'info',
  issued: 'info',
  partially_allocated: 'info',
  partially_paid: 'info',
  partially_received: 'info',
  received: 'success',
  submitted: 'info',
  on_hold: 'warning',
  pending: 'warning',
  review: 'warning',
  unapplied: 'warning',
  closed: 'neutral',
  cancelled: 'danger',
  failed: 'danger',
  locked: 'danger',
  overdue: 'warning',
  rejected: 'danger',
  reversed: 'danger',
  review_required: 'warning',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const normalized = status.toLowerCase().replaceAll(' ', '_');
  const label = status
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return (
    <Badge tone={statusTone[normalized] ?? 'neutral'} className={cn('rb-status-badge', className)}>
      {label}
    </Badge>
  );
}
