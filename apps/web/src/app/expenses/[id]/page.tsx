import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { ExpensesPage } from '../../../components/expenses-workbench';

export const metadata: Metadata = { title: 'Expense | ValueBooks' };

export default async function ExpenseRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <ExpensesPage initialSelectedExpenseId={id} />
    </AppShell>
  );
}
