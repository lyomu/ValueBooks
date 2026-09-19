import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { RecurringBillsPage } from '../../components/recurring-bills-workbench';

export const metadata: Metadata = { title: 'Recurring bills | ValueBooks' };

export default function RecurringBillsRoute() {
  return (
    <AppShell>
      <RecurringBillsPage />
    </AppShell>
  );
}
