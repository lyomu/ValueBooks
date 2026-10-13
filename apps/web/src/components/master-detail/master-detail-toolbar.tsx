import type { ReactNode } from 'react';

export function MasterDetailToolbar({ children }: { children: ReactNode }) {
  return <div className="rb-master-detail__toolbar rb-record-workspace__toolbar">{children}</div>;
}
