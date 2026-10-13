import type { Metadata } from 'next';
import { AppShell } from '../../../components/app-shell';
import { InventoryAdjustmentsPage } from '../../../components/inventory-workbench';
export const metadata: Metadata = { title: 'Inventory adjustment | ValueBooks' };
export default async function InventoryAdjustmentRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <InventoryAdjustmentsPage initialSelectedAdjustmentId={id} />
    </AppShell>
  );
}
