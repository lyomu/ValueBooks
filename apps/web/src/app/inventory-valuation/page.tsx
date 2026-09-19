import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { InventoryValuationPage } from '../../components/inventory-workbench';

export const metadata: Metadata = { title: 'Inventory valuation | ValueBooks' };

export default function Page() {
  return (
    <AppShell>
      <InventoryValuationPage />
    </AppShell>
  );
}
