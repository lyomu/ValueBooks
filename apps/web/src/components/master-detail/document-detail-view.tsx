import type { ReactNode } from 'react';

/** Shared document-detail content boundary for branded, read-only financial documents. */
export function DocumentDetailView({ children }: { children: ReactNode }) {
  return <div className="rb-master-detail__document">{children}</div>;
}
