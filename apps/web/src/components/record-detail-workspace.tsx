'use client';

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';
import { Button, Input } from '@valuebooks/ui';

export type RecordDetailWorkspaceProps<T extends { id: string }> = {
  title: string;
  records: readonly T[];
  selectedId: string;
  onSelect: (record: T) => void;
  onClose: () => void;
  searchText: (record: T) => string;
  renderRailRecord: (record: T, selected: boolean) => ReactNode;
  renderDetail: (record: T) => ReactNode;
  actions?: ReactNode;
  /** `compact` renders the Zoho-style narrow list rail with a toolbar-driven detail pane. */
  variant?: 'default' | 'compact';
  /** Compact only: replaces the rail heading (e.g. a title with a "new" button). */
  railHeader?: ReactNode;
  /** Compact only: heading shown at the left of the detail header. */
  detailTitle?: (record: T) => ReactNode;
  /** Compact only: action row rendered beneath the detail heading. */
  toolbar?: (record: T) => ReactNode;
  /** Compact only: actions rendered on the heading line itself, before the close button. */
  headerActions?: (record: T) => ReactNode;
};

/** A reusable master-detail frame for operational record inspection. */
export function RecordDetailWorkspace<T extends { id: string }>({
  title,
  records,
  selectedId,
  onSelect,
  onClose,
  searchText,
  renderRailRecord,
  renderDetail,
  actions,
  variant = 'default',
  railHeader,
  detailTitle,
  toolbar,
  headerActions,
}: RecordDetailWorkspaceProps<T>) {
  const selected = records.find((record) => record.id === selectedId) ?? records[0];
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const visibleRecords = records.filter((record) =>
    searchText(record).toLowerCase().includes(query.trim().toLowerCase()),
  );

  if (!selected) return null;

  if (variant === 'compact') {
    return (
      <section
        className="rb-record-workspace rb-record-workspace--compact"
        aria-label={`${title} details`}
      >
        <aside className="rb-record-workspace__rail" aria-label={`${title} list`}>
          <div className="rb-record-workspace__rail-head">{railHeader ?? <h1>{title}</h1>}</div>
          <label className="rb-record-workspace__search">
            <Search aria-hidden="true" />
            <span className="rb-visually-hidden">Search {title}</span>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${title}`}
            />
          </label>
          <div
            className="rb-record-workspace__records"
            role="listbox"
            aria-label={`${title} records`}
          >
            {visibleRecords.map((record) => {
              const isSelected = record.id === selected.id;
              return (
                <div
                  key={record.id}
                  className="rb-record-workspace__row"
                  data-selected={isSelected || undefined}
                >
                  <input
                    type="checkbox"
                    className="rb-record-workspace__check"
                    aria-label="Select record"
                    checked={checked.has(record.id)}
                    onChange={(event) => {
                      const next = new Set(checked);
                      if (event.target.checked) next.add(record.id);
                      else next.delete(record.id);
                      setChecked(next);
                    }}
                  />
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className="rb-record-workspace__record"
                    data-selected={isSelected || undefined}
                    onClick={() => onSelect(record)}
                  >
                    {renderRailRecord(record, isSelected)}
                  </button>
                </div>
              );
            })}
            {visibleRecords.length === 0 ? (
              <p className="rb-record-workspace__none">No matching {title.toLowerCase()}.</p>
            ) : null}
          </div>
        </aside>
        <article className="rb-record-workspace__detail">
          <header className="rb-record-workspace__detail-head">
            <div className="rb-record-workspace__detail-title">{detailTitle?.(selected)}</div>
            {headerActions ? (
              <div className="rb-record-workspace__detail-actions">{headerActions(selected)}</div>
            ) : null}
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details">
              <X aria-hidden="true" />
            </Button>
          </header>
          {toolbar ? <div className="rb-record-workspace__toolbar">{toolbar(selected)}</div> : null}
          <div className="rb-record-workspace__detail-body">{renderDetail(selected)}</div>
        </article>
      </section>
    );
  }

  return (
    <section className="rb-record-workspace" aria-label={`${title} details`}>
      <aside className="rb-record-workspace__rail" aria-label={`${title} list`}>
        <div className="rb-record-workspace__rail-head">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={`Return to ${title}`}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <h1>{title}</h1>
        </div>
        <label className="rb-record-workspace__search">
          <span className="rb-visually-hidden">Search {title}</span>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${title}`}
          />
        </label>
        <div
          className="rb-record-workspace__records"
          role="listbox"
          aria-label={`${title} records`}
        >
          {visibleRecords.map((record) => (
            <button
              key={record.id}
              type="button"
              role="option"
              aria-selected={record.id === selected.id}
              className="rb-record-workspace__record"
              data-selected={record.id === selected.id || undefined}
              onClick={() => onSelect(record)}
            >
              {renderRailRecord(record, record.id === selected.id)}
            </button>
          ))}
        </div>
      </aside>
      <article className="rb-record-workspace__detail">
        <header className="rb-record-workspace__detail-head">
          <div>{actions}</div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details">
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className="rb-record-workspace__detail-body">{renderDetail(selected)}</div>
      </article>
    </section>
  );
}
