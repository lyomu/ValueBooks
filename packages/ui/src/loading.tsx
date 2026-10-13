import type { HTMLAttributes } from 'react';

import { cn } from './utils';

export function Spinner({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('rb-spinner', className)} role="status" aria-label="Loading" {...props} />
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rb-skeleton', className)} aria-hidden="true" {...props} />;
}

export function TableSkeleton({ columns = 4, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr className="rb-table__skeleton-row" key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <td key={column}>
              <Skeleton className={column === 0 ? 'rb-skeleton--table-primary' : undefined} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="rb-card-skeleton" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
}
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="rb-form-skeleton" aria-busy="true">
      {Array.from({ length: fields }, (_, index) => (
        <div key={index}>
          <Skeleton className="rb-skeleton--label" />
          <Skeleton className="rb-skeleton--field" />
        </div>
      ))}
    </div>
  );
}
export function ChartSkeleton({ height = '16rem' }: { height?: string }) {
  return (
    <div className="rb-chart-skeleton" style={{ height }} aria-busy="true">
      <Skeleton />
    </div>
  );
}
export function DetailSkeleton({ variant = 'document' }: { variant?: 'document' | 'profile' }) {
  return (
    <div className={cn('rb-detail-skeleton', `rb-detail-skeleton--${variant}`)} aria-busy="true">
      <Skeleton className="rb-skeleton--title" />
      <CardSkeleton count={variant === 'document' ? 6 : 4} />
    </div>
  );
}
export const ReportSkeleton = ({ rows = 8 }: { rows?: number }) => <TableSkeleton rows={rows} />;
export const DocumentPreviewSkeleton = () => (
  <div className="rb-document-preview-skeleton" aria-busy="true">
    <Skeleton className="rb-skeleton--title" />
    <Skeleton />
    <Skeleton />
    <Skeleton />
  </div>
);
export const PageSkeleton = () => (
  <div className="rb-page-skeleton" aria-busy="true">
    <Skeleton className="rb-skeleton--title" />
    <CardSkeleton count={4} />
  </div>
);
export const ButtonSpinner = Spinner;
export function LoadingOverlay({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="rb-loading-overlay" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
