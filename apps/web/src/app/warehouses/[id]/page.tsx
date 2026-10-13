import type { Metadata } from 'next';
import { AppShell } from '../../../components/app-shell';
import { WarehousesPage } from '../../../components/inventory-workbench';
export const metadata: Metadata = { title: 'Warehouse | ValueBooks' };
export default async function WarehouseRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <WarehousesPage initialSelectedWarehouseId={id} />
    </AppShell>
  );
}
