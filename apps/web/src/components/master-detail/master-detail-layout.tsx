'use client';

import { useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button, Input } from '@valuebooks/ui';
import type { MasterDetailLayoutProps, MasterDetailRecord } from './master-detail-types';
import { nextMasterDetailIndex } from './master-detail-navigation';
import { MasterDetailEmptyState } from './master-detail-empty-state';
import { MasterDetailErrorState } from './master-detail-error-state';
import { MasterDetailSkeleton } from './master-detail-skeleton';
import { MasterDetailToolbar } from './master-detail-toolbar';
import { MasterDetailListPanel } from './master-detail-list-panel';
import { MasterDetailListItem } from './master-detail-list-item';

export type { MasterDetailLayoutProps, MasterDetailRecord } from './master-detail-types';

/**
 * The shared record-inspection frame. Modules provide record content and actions;
 * the list rail, selection semantics, responsive behaviour, and scrolling remain shared.
 */
export function MasterDetailLayout<T extends MasterDetailRecord>({
  title,
  records,
  selectedId,
  onSelect,
  onClose,
  recordHref,
  searchText,
  renderListItem,
  renderDetail,
  railHeader,
  detailTitle,
  toolbar,
  headerActions,
  detailLoading = false,
  detailError,
  onRetryDetail,
}: MasterDetailLayoutProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = records.find((record) => record.id === selectedId) ?? records[0];
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const query = searchParams.get('q') ?? '';
  const visibleRecords = records.filter((record) =>
    searchText(record).toLowerCase().includes(query.trim().toLowerCase()),
  );

  if (!selected) return null;

  function setQuery(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set('q', value);
    else next.delete('q');
    const serialized = next.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false });
  }

  function hrefFor(record: T) {
    const href = recordHref?.(record) ?? '#';
    if (!recordHref || !searchParams.toString()) return href;
    const separator = href.includes('?') ? '&' : '?';
    return `${href}${separator}${searchParams.toString()}`;
  }

  function moveSelection(event: KeyboardEvent<HTMLElement>, record: T) {
    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    event.preventDefault();
    const currentIndex = visibleRecords.findIndex((candidate) => candidate.id === record.id);
    const nextIndex = nextMasterDetailIndex(currentIndex, visibleRecords.length, event.key);
    const next = visibleRecords[nextIndex];
    if (!next) return;
    onSelect(next);
    document.getElementById(`master-detail-record-${next.id}`)?.focus();
  }

  return (
    <section
      className="rb-master-detail rb-record-workspace rb-record-workspace--compact"
      aria-label={`${title} details`}
    >
      <aside
        className="rb-master-detail__rail rb-record-workspace__rail"
        aria-label={`${title} list`}
      >
        <div className="rb-master-detail__rail-head rb-record-workspace__rail-head">
          {railHeader ?? <h1>{title}</h1>}
        </div>
        <label className="rb-master-detail__search rb-record-workspace__search">
          <Search aria-hidden="true" />
          <span className="rb-visually-hidden">Search {title}</span>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${title}`}
          />
        </label>
        <MasterDetailListPanel title={title}>
          {visibleRecords.map((record) => {
            const isSelected = record.id === selected.id;
            return (
              <div
                key={record.id}
                className="rb-master-detail__row rb-record-workspace__row"
                data-selected={isSelected || undefined}
              >
                <input
                  type="checkbox"
                  className="rb-master-detail__check rb-record-workspace__check"
                  aria-label={`Select ${title.slice(0, -1) || 'record'}`}
                  checked={checked.has(record.id)}
                  onChange={(event) => {
                    const next = new Set(checked);
                    if (event.target.checked) next.add(record.id);
                    else next.delete(record.id);
                    setChecked(next);
                  }}
                />
                <MasterDetailListItem
                  id={`master-detail-record-${record.id}`}
                  selected={isSelected}
                  href={hrefFor(record)}
                  onSelect={() => {
                    onSelect(record);
                  }}
                  onKeyDown={(event) => {
                    if (!recordHref) event.preventDefault();
                    moveSelection(event, record);
                  }}
                >
                  {renderListItem(record, isSelected)}
                </MasterDetailListItem>
              </div>
            );
          })}
          {visibleRecords.length === 0 ? <MasterDetailEmptyState title={title} /> : null}
        </MasterDetailListPanel>
      </aside>
      <article className="rb-master-detail__detail rb-record-workspace__detail">
        <header className="rb-master-detail__detail-head rb-record-workspace__detail-head">
          <div className="rb-master-detail__detail-title rb-record-workspace__detail-title">
            {detailTitle?.(selected)}
          </div>
          {headerActions ? (
            <div className="rb-master-detail__detail-actions rb-record-workspace__detail-actions">
              {headerActions(selected)}
            </div>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={`Back to ${title} list`}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
        </header>
        {toolbar ? <MasterDetailToolbar>{toolbar(selected)}</MasterDetailToolbar> : null}
        <div
          className="rb-master-detail__detail-body rb-record-workspace__detail-body"
          aria-busy={detailLoading || undefined}
        >
          {detailLoading ? <MasterDetailSkeleton /> : null}
          {!detailLoading && detailError ? (
            <MasterDetailErrorState message={detailError} onRetry={onRetryDetail} />
          ) : null}
          {!detailLoading && !detailError ? renderDetail(selected) : null}
        </div>
      </article>
    </section>
  );
}

export function MasterDetailBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={onClick} aria-label={label}>
      <ArrowLeft aria-hidden="true" />
    </Button>
  );
}
