import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { SalesOrdersPage } from '../../../components/sales-orders-workbench';

export const metadata: Metadata = { title: 'Sales order | ValueBooks' };

export default async function SalesOrderRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <SalesOrdersPage initialSelectedOrderId={id} />
    </AppShell>
  );
}
