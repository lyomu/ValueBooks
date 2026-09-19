import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { RecurringInvoicesPage } from '../../components/recurring-invoices-workbench';

export const metadata: Metadata = { title: 'Recurring invoices | ValueBooks' };

export default function RecurringInvoicesRoute() {
  return (
    <AppShell>
      <RecurringInvoicesPage />
    </AppShell>
  );
}
