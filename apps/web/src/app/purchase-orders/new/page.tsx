import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { PurchaseOrderEditorPage } from '../../../components/purchase-orders-workbench';

export const metadata: Metadata = { title: 'New purchase order | ValueBooks' };

export default function NewPurchaseOrderRoute() {
  return (
    <AppShell>
      <PurchaseOrderEditorPage />
    </AppShell>
  );
}
