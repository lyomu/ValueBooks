'use client';

import type { ReactNode } from 'react';

import {
  MasterDetailLayout,
  type MasterDetailLayoutProps,
} from './master-detail/master-detail-layout';

export type RecordDetailWorkspaceProps<T extends { id: string }> = {
  title: string;
  records: readonly T[];
  selectedId: string;
  onSelect: (record: T) => void;
  onClose: () => void;
  recordHref?: (record: T) => string;
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
  detailLoading?: boolean;
  detailError?: string | null;
  onRetryDetail?: () => void;
};

/** A reusable master-detail frame for operational record inspection. */
export function RecordDetailWorkspace<T extends { id: string }>({
  title,
  records,
  selectedId,
  onSelect,
  onClose,
  recordHref,
  searchText,
  renderRailRecord,
  renderDetail,
  actions,
  variant = 'default',
  railHeader,
  detailTitle,
  toolbar,
  headerActions,
  detailLoading,
  detailError,
  onRetryDetail,
}: RecordDetailWorkspaceProps<T>) {
  if (variant !== 'compact') return null;

  const props: MasterDetailLayoutProps<T> = {
    title,
    records,
    selectedId,
    onSelect,
    onClose,
    recordHref,
    searchText,
    renderListItem: renderRailRecord,
    renderDetail,
    railHeader,
    detailTitle,
    toolbar,
    headerActions,
    detailLoading,
    detailError,
    onRetryDetail,
  };

  return <MasterDetailLayout {...props} />;
}
