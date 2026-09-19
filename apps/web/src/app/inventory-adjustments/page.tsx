import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { InventoryAdjustmentsPage } from '../../components/inventory-workbench';

export const metadata: Metadata = { title: 'Inventory adjustments | ValueBooks' };

export default function Page() {
  return (
    <AppShell>
      <InventoryAdjustmentsPage />
    </AppShell>
  );
}
