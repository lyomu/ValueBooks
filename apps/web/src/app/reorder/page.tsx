import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { ReorderPage } from '../../components/inventory-workbench';

export const metadata: Metadata = { title: 'Reorder | ValueBooks' };

export default function Page() {
  return (
    <AppShell>
      <ReorderPage />
    </AppShell>
  );
}
