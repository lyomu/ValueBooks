import type { ReactNode } from 'react';

export function MasterDetailListPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="rb-master-detail__records rb-record-workspace__records"
      role="listbox"
      aria-label={`${title} records`}
    >
      {children}
    </div>
  );
}
