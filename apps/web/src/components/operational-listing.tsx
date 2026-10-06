'use client';

import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
  EmptyState,
  Input,
  type EmptyStateConfig,
} from '@valuebooks/ui';
import {
  ArrowDownUp,
  Download,
  Filter,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Upload,
} from 'lucide-react';

export type ListingColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  value?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'center' | 'right';
  width?: string;
};

type SortDirection = 'asc' | 'desc';

export type OperationalListingConfig<T extends { id: string }> = {
  title: string;
  rows: readonly T[];
  columns: readonly ListingColumn<T>[];
  searchText: (row: T) => string;
  filter?: ReactNode;
  primaryAction?: ReactNode;
  onRefresh?: () => void;
  onImport?: (file: File, sourceNamespace: string) => Promise<void> | void;
  /** Derived inventory read models can opt out of source-record imports. */
  importEnabled?: boolean;
  emptyState?: EmptyStateConfig;
  noResultsState?: EmptyStateConfig;
  onResetFilters?: () => void;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
};

function textValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value) ?? '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  return '';
}

function isColumnWidthMap(value: unknown): value is Record<string, number> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.values(value).every((width) => typeof width === 'number' && Number.isFinite(width))
  );
}

function csvCell(value: unknown): string {
  const text = textValue(value).replace(/\r?\n/g, ' ');
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function flattenRecord(value: unknown, prefix = '', output: Record<string, string> = {}) {
  if (value === null || value === undefined) return output;
  if (Array.isArray(value)) return output;
  if (typeof value !== 'object') {
    output[prefix] = textValue(value);
    return output;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    const path = prefix ? `${prefix}_${key}` : key;
    if (Array.isArray(child)) return;
    if (child !== null && typeof child === 'object') flattenRecord(child, path, output);
    else output[path] = textValue(child);
  });
  return output;
}

function flattenForCsv<T extends { id: string }>(rows: readonly T[]) {
  return rows.flatMap((row) => {
    const source = row as Record<string, unknown>;
    const parent = flattenRecord(source);
    const childGroups = Object.entries(source).filter((entry): entry is [string, unknown[]] =>
      Array.isArray(entry[1]),
    );
    if (childGroups.length === 0) return [parent];
    const primaryChildGroup = childGroups.sort(
      ([, first], [, second]) => second.length - first.length,
    )[0];
    if (!primaryChildGroup) return [parent];
    const [relationship, children] = primaryChildGroup;
    return children.length > 0
      ? children.map((child, index) => ({
          ...parent,
          import_child_relation: relationship,
          import_child_index: String(index + 1),
          ...flattenRecord(child, relationship),
        }))
      : [parent];
  });
}

function downloadCsv<T extends { id: string }>(title: string, rows: readonly T[]) {
  const detailRows = flattenForCsv(rows);
  const headers = [...new Set(detailRows.flatMap((row) => Object.keys(row)))];
  const csvRows = detailRows.map((row) => headers.map((header) => csvCell(row[header])).join(','));
  const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-export.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function OperationalListing<T extends { id: string }>({
  title,
  rows,
  columns,
  searchText,
  filter,
  primaryAction,
  onRefresh,
  onImport,
  importEnabled = true,
  emptyState,
  noResultsState,
  onResetFilters,
  onRowClick,
  empty,
}: OperationalListingConfig<T>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(
    columns.find((column) => column.value)?.key ?? columns[0]?.key ?? '',
  );
  const [direction, setDirection] = useState<SortDirection>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [namespace, setNamespace] = useState('migration');
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const layoutKey = `valuebooks:list-layout:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(layoutKey);
      const parsed: unknown = saved ? JSON.parse(saved) : {};
      setColumnWidths(isColumnWidthMap(parsed) ? parsed : {});
    } catch {
      setColumnWidths({});
    }
  }, [layoutKey]);

  useEffect(() => {
    if (Object.keys(columnWidths).length === 0) return;
    window.localStorage.setItem(layoutKey, JSON.stringify(columnWidths));
  }, [columnWidths, layoutKey]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? rows.filter((row) => searchText(row).toLowerCase().includes(needle))
      : [...rows];
    const column = columns.find((candidate) => candidate.key === sortKey);
    if (!column?.value) return matching;
    return matching.sort((left, right) => {
      const first = textValue(column.value?.(left)).toLowerCase();
      const second = textValue(column.value?.(right)).toLowerCase();
      const order = first.localeCompare(second, undefined, { numeric: true });
      return direction === 'asc' ? order : -order;
    });
  }, [columns, direction, query, rows, searchText, sortKey]);

  function toggleAll() {
    setSelectedIds((current) =>
      current.size === visibleRows.length ? new Set() : new Set(visibleRows.map((row) => row.id)),
    );
  }

  function resetListView() {
    setQuery('');
    setSelectedIds(new Set());
    setSortKey(columns[0]?.key ?? '');
    setDirection('asc');
    setColumnWidths({});
    window.localStorage.removeItem(layoutKey);
    onResetFilters?.();
  }

  async function submitImport() {
    if (!importFile || !onImport) return;
    await onImport(importFile, namespace.trim() || 'migration');
    setShowImport(false);
    setImportFile(null);
  }

  function resizeColumn(key: string, event: ReactMouseEvent<HTMLSpanElement>) {
    const header = event.currentTarget.parentElement;
    if (!header) return;
    const startX = event.clientX;
    const startWidth = header.getBoundingClientRect().width;
    const update = (moveEvent: MouseEvent) => {
      setColumnWidths((current) => ({
        ...current,
        [key]: Math.max(104, Math.round(startWidth + moveEvent.clientX - startX)),
      }));
    };
    const finish = () => {
      window.removeEventListener('mousemove', update);
      window.removeEventListener('mouseup', finish);
    };
    window.addEventListener('mousemove', update);
    window.addEventListener('mouseup', finish);
  }

  const exportRows =
    selectedIds.size > 0 ? visibleRows.filter((row) => selectedIds.has(row.id)) : visibleRows;
  const isDatasetEmpty = rows.length === 0;
  const isNoResults = !isDatasetEmpty && visibleRows.length === 0;
  const legacyEmptyDescription = typeof empty === 'string' ? empty : undefined;
  const resolvedEmptyState: EmptyStateConfig = isNoResults
    ? {
        title: `No ${title.toLowerCase()} match this view`,
        description: 'Try clearing the search or filters to see your records.',
        variant: 'no-results',
        action: (
          <Button variant="outline" onClick={resetListView}>
            Clear view
          </Button>
        ),
        ...noResultsState,
      }
    : {
        title: `Start with your first ${title.replace(/^all\s+/i, '').replace(/s$/i, '')}`,
        description: 'Create a record to begin tracking it here.',
        variant: 'onboarding',
        illustration: 'administration',
        action: primaryAction,
        ...emptyState,
      };

  return (
    <section className="rb-operational-listing">
      <header className="rb-operational-listing__head">
        <div className="rb-operational-listing__title">
          <h1>{title}</h1>
          <span aria-hidden="true">⌄</span>
        </div>
        <div className="rb-operational-listing__actions">
          {primaryAction ?? (
            <Button>
              <Plus aria-hidden="true" /> New
            </Button>
          )}
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="outline" size="icon" aria-label={`More ${title} actions`}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownTrigger>
            <DropdownContent align="end" className="rb-operational-listing__menu">
              <DropdownItem onSelect={() => setShowFilters((current) => !current)}>
                <Filter aria-hidden="true" /> Filters
              </DropdownItem>
              {importEnabled ? (
                <DropdownItem onSelect={() => setShowImport(true)}>
                  <Upload aria-hidden="true" /> Import
                </DropdownItem>
              ) : null}
              <DropdownItem onSelect={() => downloadCsv(title, exportRows)}>
                <Download aria-hidden="true" /> Export full details
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem onSelect={onRefresh}>
                <RefreshCw aria-hidden="true" /> Refresh list
              </DropdownItem>
              <DropdownItem onSelect={resetListView}>
                <RotateCcw aria-hidden="true" /> Reset list view
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        </div>
      </header>

      <div className="rb-operational-listing__tools">
        <label className="rb-operational-listing__search">
          <Search aria-hidden="true" />
          <span className="rb-visually-hidden">Search {title}</span>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search in ${title}`}
          />
        </label>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowFilters((current) => !current)}
          aria-label="Show filters"
        >
          <Filter aria-hidden="true" />
        </Button>
        {showFilters ? (
          <div className="rb-operational-listing__filters">
            {filter ?? <span>No additional filters.</span>}
          </div>
        ) : null}
      </div>

      {visibleRows.length === 0 ? (
        empty !== undefined && typeof empty !== 'string' ? (
          empty
        ) : (
          <EmptyState
            {...resolvedEmptyState}
            description={legacyEmptyDescription ?? resolvedEmptyState.description}
          />
        )
      ) : (
        <div className="rb-operational-listing__table-wrap">
          <table className="rb-operational-listing__table">
            <thead>
              <tr>
                <th className="rb-operational-listing__select">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === visibleRows.length}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    style={{ width: columnWidths[column.key] ?? column.width }}
                    className={column.align === 'right' ? 'rb-table--right' : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!column.value) return;
                        setDirection(
                          sortKey === column.key && direction === 'asc' ? 'desc' : 'asc',
                        );
                        setSortKey(column.key);
                      }}
                      disabled={!column.value}
                    >
                      {column.header}
                      {column.value ? <ArrowDownUp aria-hidden="true" /> : null}
                    </button>
                    <span
                      className="rb-operational-listing__resize"
                      onMouseDown={(event) => resizeColumn(column.key, event)}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${textValue(column.header)} column`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => {
                    onRowClick?.(row);
                  }}
                  data-clickable={onRowClick ? 'true' : undefined}
                >
                  <td className="rb-operational-listing__select">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() =>
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                      aria-label="Select row"
                    />
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={column.align === 'right' ? 'rb-table--right rb-num' : undefined}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent
          title={`Import ${title}`}
          description="Upload a flattened CSV, confirm its source namespace, then continue to mapping and validation."
        >
          <div className="rb-operational-import">
            <label>
              Source namespace
              <Input
                value={namespace}
                onChange={(event) => setNamespace(event.target.value)}
                placeholder="e.g. zoho-books-2026"
              />
            </label>
            <label>
              CSV file
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {importFile ? <p>{importFile.name} is ready for column mapping.</p> : null}
            <div className="rb-dialog-footer">
              <Button variant="outline" onClick={() => setShowImport(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submitImport()} disabled={!importFile || !onImport}>
                Preview and map
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
