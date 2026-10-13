import type { Metadata } from 'next';
import { AppShell } from '../../../../components/app-shell';
import { SalesOrderEditorPage } from '../../../../components/sales-orders-workbench';
export const metadata: Metadata = { title: 'Edit sales order | ValueBooks' };
export default async function EditSalesOrderRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <SalesOrderEditorPage orderId={id} />
    </AppShell>
  );
}
