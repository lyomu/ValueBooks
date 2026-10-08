import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AppShell } from '../../components/app-shell';
import { ListingWithRecurring } from '../../components/listing-with-recurring';
import { InvoicesPage } from '../../components/invoices-workbench';
import { RecurringInvoicesPage } from '../../components/recurring-invoices-workbench';

export const metadata: Metadata = { title: 'Invoices | ValueBooks' };

export default function InvoicesRoute() {
  return (
    <AppShell>
      <Suspense fallback={<InvoicesPage />}>
        <ListingWithRecurring
          documentsLabel="Invoices"
          recurringPermission="sales.recurring_invoices.view"
          documents={<InvoicesPage />}
          recurring={<RecurringInvoicesPage />}
        />
      </Suspense>
    </AppShell>
  );
}
