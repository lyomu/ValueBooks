import type { ReactNode } from 'react';

/** The smallest common contract for a record that can appear in the master list. */
export type MasterDetailRecord = { id: string };

export type MasterDetailLayoutProps<T extends MasterDetailRecord> = {
  title: string;
  records: readonly T[];
  selectedId: string;
  onSelect: (record: T) => void;
  onClose: () => void;
  recordHref?: (record: T) => string;
  searchText: (record: T) => string;
  renderListItem: (record: T, selected: boolean) => ReactNode;
  renderDetail: (record: T) => ReactNode;
  railHeader?: ReactNode;
  detailTitle?: (record: T) => ReactNode;
  toolbar?: (record: T) => ReactNode;
  headerActions?: (record: T) => ReactNode;
  detailLoading?: boolean;
  detailError?: string | null;
  onRetryDetail?: () => void;
};
