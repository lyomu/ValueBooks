import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { PurchaseOrdersPage } from '../../components/purchase-orders-workbench';

export const metadata: Metadata = { title: 'Purchase orders | ValueBooks' };

export default function PurchaseOrdersRoute() {
  return (
    <AppShell>
      <PurchaseOrdersPage />
    </AppShell>
  );
}
