import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { FinancialAccountsPage } from '../../components/banking-workbench';

export const metadata: Metadata = { title: 'Financial accounts | ValueBooks' };

export default function Page() {
  return (
    <AppShell>
      <FinancialAccountsPage />
    </AppShell>
  );
}
