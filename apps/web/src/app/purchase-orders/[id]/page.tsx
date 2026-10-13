import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { PurchaseOrdersPage } from '../../../components/purchase-orders-workbench';

export const metadata: Metadata = { title: 'Purchase order | ValueBooks' };

export default async function PurchaseOrderRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <PurchaseOrdersPage initialSelectedOrderId={id} />
    </AppShell>
  );
}
