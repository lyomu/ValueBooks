import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { ReconciliationsPage } from '../../components/banking-workbench';

export const metadata: Metadata = { title: 'Reconciliation | ValueBooks' };

export default function Page() {
  return (
    <AppShell>
      <ReconciliationsPage />
    </AppShell>
  );
}
