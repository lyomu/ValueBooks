import { SearchX } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card } from './card';
import { EmptyState, type EmptyStateConfig } from './empty-state';
import { Spinner } from './loading';
import { cn } from './utils';

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Plain comparable value used by interactive listing variants. */
  value?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'center' | 'right';
  hideBelow?: 'tablet' | 'desktop';
  width?: string;
};

export function DataTable<T extends { id: string }>({
  caption,
  columns,
  rows,
  onRowClick,
  loading = false,
  emptyTitle = 'No records yet',
  emptyDescription,
  emptyState,
}: {
  caption: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyState?: Omit<EmptyStateConfig, 'title' | 'description'> & Partial<Pick<EmptyStateConfig, 'title' | 'description'>>;
}) {
  const inferredNoResults = /\b(match|filter|search|nothing)\b/i.test(`${emptyTitle} ${emptyDescription ?? ''}`);
  const resolvedEmptyState: EmptyStateConfig = {
    ...emptyState,
    title: emptyState?.title ?? emptyTitle,
    description: emptyState?.description ?? emptyDescription,
    variant: emptyState?.variant ?? (inferredNoResults ? 'no-results' : 'onboarding'),
  };

  return (
    <Card className="rb-table-card">
      <div className="rb-table-scroll">
        <table className="rb-table">
          <caption className="rb-visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={{ width: column.width }}
                  className={cn(
                    column.align && `rb-table--${column.align}`,
                    column.hideBelow && `rb-table--hide-${column.hideBelow}`,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="rb-table__state">
                  <span className="rb-table__loading">
                    <Spinner /> Loading records…
                  </span>
                </td>
              </tr>
            ) : null}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="rb-table__state">
                  <EmptyState icon={SearchX} {...resolvedEmptyState} />
                </td>
              </tr>
            ) : null}
            {!loading
              ? rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(onRowClick && 'rb-table__row--interactive')}
                    onClick={() => onRowClick?.(row)}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          column.align && `rb-table--${column.align}`,
                          column.align === 'right' && 'rb-num',
                          column.hideBelow && `rb-table--hide-${column.hideBelow}`,
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
