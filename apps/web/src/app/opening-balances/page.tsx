import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { OpeningBalancesPage } from '../../components/opening-balances-workbench';

export const metadata: Metadata = { title: 'Opening balances | ValueBooks' };

export default function OpeningBalancesRoute() {
  return (
    <AppShell>
      <OpeningBalancesPage />
    </AppShell>
  );
}
