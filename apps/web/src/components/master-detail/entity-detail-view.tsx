import type { ReactNode } from 'react';

/** Shared entity-detail content boundary for non-printable business records. */
export function EntityDetailView({ children }: { children: ReactNode }) {
  return <div className="rb-master-detail__entity">{children}</div>;
}
