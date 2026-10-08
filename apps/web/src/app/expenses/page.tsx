import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AppShell } from '../../components/app-shell';
import { ListingWithRecurring } from '../../components/listing-with-recurring';
import { ExpensesPage } from '../../components/expenses-workbench';
import { RecurringExpensesPage } from '../../components/recurring-expenses-workbench';

export const metadata: Metadata = { title: 'Expenses | ValueBooks' };

export default function ExpensesRoute() {
  return (
    <AppShell>
      <Suspense fallback={<ExpensesPage />}>
        <ListingWithRecurring
          documentsLabel="Expenses"
          recurringPermission="purchases.recurring_expenses.view"
          documents={<ExpensesPage />}
          recurring={<RecurringExpensesPage />}
        />
      </Suspense>
    </AppShell>
  );
}
