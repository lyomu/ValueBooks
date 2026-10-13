import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { VendorCreditsPage } from '../../../components/vendor-credits-workbench';

export const metadata: Metadata = { title: 'Vendor credit | ValueBooks' };

export default async function VendorCreditRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <VendorCreditsPage initialSelectedVendorCreditId={id} />
    </AppShell>
  );
}
