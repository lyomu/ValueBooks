import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AppShell } from '../../components/app-shell';
import { ListingWithRecurring } from '../../components/listing-with-recurring';
import { JournalsPage } from '../../components/ledger-workbench';
import { RecurringJournalsPage } from '../../components/recurring-journals-workbench';

export const metadata: Metadata = { title: 'Journals | ValueBooks' };

export default function JournalsRoute() {
  return (
    <AppShell>
      <Suspense fallback={<JournalsPage />}>
        <ListingWithRecurring
          documentsLabel="Journals"
          recurringPermission="journals.recurring.view"
          documents={<JournalsPage />}
          recurring={<RecurringJournalsPage />}
        />
      </Suspense>
    </AppShell>
  );
}
