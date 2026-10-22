import { Filter, MoreHorizontal, Search, SearchX } from 'lucide-react';
import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

import { Button } from './button';
import { Card } from './card';
import { Dropdown, DropdownContent, DropdownTrigger } from './dropdown';
import { EmptyState, type EmptyStateConfig } from './empty-state';
import { Input } from './form';
import { TableSkeleton } from './loading';
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

/**
 * Keeps a record's primary label and supporting metadata legible in compact
 * listing tables. Pass a Link as `primary` when the record has a detail route.
 */
export function PrimarySecondaryCell({
  primary,
  secondary,
  primaryTitle,
  secondaryTitle,
  className,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  primaryTitle?: string;
  secondaryTitle?: string;
  className?: string;
}) {
  return (
    <div className={cn('rb-table-primary-secondary', className)}>
      <span className="rb-table-primary-secondary__primary" title={primaryTitle}>
        {primary}
      </span>
      {secondary ? (
        <span className="rb-table-primary-secondary__secondary" title={secondaryTitle}>
          {secondary}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The shared control strip for record lists. Screens provide their search and
 * context-specific filters, while the shell, result count, and responsive
 * behavior remain identical across the product.
 */
export function DataTableToolbar({
  children,
  resultLabel,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { resultLabel?: ReactNode }) {
  return (
    <div className={cn('rb-data-table-toolbar', className)} {...props}>
      <div className="rb-data-table-toolbar__controls">{children}</div>
      {resultLabel ? <span className="rb-data-table-toolbar__count">{resultLabel}</span> : null}
    </div>
  );
}

/** Standard search control for listing and report toolbars. */
export function DataTableSearch({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="rb-data-table-toolbar__search">
      <Search aria-hidden="true" />
      <span className="rb-visually-hidden">{label}</span>
      <Input className={className} {...props} />
    </label>
  );
}

/** Standard filter group for listing and report toolbars. */
export function DataTableFilters({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rb-data-table-toolbar__filter', className)} {...props}>
      <Filter aria-hidden="true" />
      {children}
    </div>
  );
}

/**
 * A shared, keyboard-accessible entry point for valid secondary record actions.
 * Keep the primary route as a real reference link in its own column; use this
 * menu only for contextual actions such as edit, duplicate, archive, or void.
 */
export function RowActionMenu({
  children,
  label = 'More actions',
  disabled = false,
}: {
  children: ReactNode;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rb-row-action-menu__trigger"
          aria-label={label}
          disabled={disabled}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end" className="rb-row-action-menu__content">
        {children}
      </DropdownContent>
    </Dropdown>
  );
}

export function DataTable<T extends { id: string }>({
  caption,
  columns,
  rows,
  onRowClick,
  loading = false,
  skeletonRows = 6,
  emptyTitle = 'No records yet',
  emptyDescription,
  emptyState,
  toolbar,
}: {
  caption: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  onRowClick?: (row: T) => void;
  loading?: boolean;
  skeletonRows?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyState?: Omit<EmptyStateConfig, 'title' | 'description'> &
    Partial<Pick<EmptyStateConfig, 'title' | 'description'>>;
  /** Optional shared search/filter strip rendered above the column headers. */
  toolbar?: ReactNode;
}) {
  const inferredNoResults = /\b(match|filter|search|nothing)\b/i.test(
    `${emptyTitle} ${emptyDescription ?? ''}`,
  );
  const resolvedEmptyState: EmptyStateConfig = {
    ...emptyState,
    title: emptyState?.title ?? emptyTitle,
    description: emptyState?.description ?? emptyDescription,
    variant: emptyState?.variant ?? (inferredNoResults ? 'no-results' : 'onboarding'),
  };

  return (
    <Card className="rb-table-card" aria-busy={loading || undefined}>
      {toolbar}
      <div className="rb-table-scroll">
        <table className="rb-table rb-table--listing">
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
            {loading ? <TableSkeleton columns={columns.length} rows={skeletonRows} /> : null}
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
                    className={cn(
                      'rb-table__row--listing',
                      onRowClick && 'rb-table__row--interactive',
                    )}
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

/**
 * Previous / next paging for a server-paginated `DataTable`. Renders nothing for a single page.
 * Place it directly after the table it pages.
 */
export function DataTablePagination({
  page,
  pageSize,
  totalRows,
  onPageChange,
  disabled = false,
  label = 'Pagination',
}: {
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(totalRows / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="rb-table-pagination" aria-label={label}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <span>
        Page {page} of {pages}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || page >= pages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
