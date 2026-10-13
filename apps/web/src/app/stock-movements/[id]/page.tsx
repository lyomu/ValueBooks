import type { Metadata } from 'next';
import { AppShell } from '../../../components/app-shell';
import { StockMovementsPage } from '../../../components/inventory-workbench';
export const metadata: Metadata = { title: 'Stock movement | ValueBooks' };
export default async function StockMovementRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <StockMovementsPage initialSelectedMovementId={id} />
    </AppShell>
  );
}
