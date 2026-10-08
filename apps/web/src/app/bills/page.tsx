import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AppShell } from '../../components/app-shell';
import { ListingWithRecurring } from '../../components/listing-with-recurring';
import { BillsPage } from '../../components/bills-workbench';
import { RecurringBillsPage } from '../../components/recurring-bills-workbench';

export const metadata: Metadata = { title: 'Bills | ValueBooks' };

export default function BillsRoute() {
  return (
    <AppShell>
      <Suspense fallback={<BillsPage />}>
        <ListingWithRecurring
          documentsLabel="Bills"
          recurringPermission="purchases.recurring_bills.view"
          documents={<BillsPage />}
          recurring={<RecurringBillsPage />}
        />
      </Suspense>
    </AppShell>
  );
}
