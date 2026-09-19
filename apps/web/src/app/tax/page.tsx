import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { TaxCodesPage } from '../../components/tax-workbench';

export const metadata: Metadata = { title: 'Tax codes | ValueBooks' };

export default function TaxPage() {
  return (
    <AppShell>
      <TaxCodesPage />
    </AppShell>
  );
}
