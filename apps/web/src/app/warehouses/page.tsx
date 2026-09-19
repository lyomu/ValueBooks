import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { WarehousesPage } from '../../components/inventory-workbench';

export const metadata: Metadata = { title: 'Warehouses | ValueBooks' };

export default function Page() {
  return (
    <AppShell>
      <WarehousesPage />
    </AppShell>
  );
}
