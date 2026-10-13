import type { Metadata } from 'next';

import { AppShell } from '../../../../components/app-shell';
import { InvoiceEditorPage } from '../../../../components/invoices-workbench';

export const metadata: Metadata = { title: 'Edit invoice | ValueBooks' };

export default async function EditInvoiceRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <InvoiceEditorPage invoiceId={id} />
    </AppShell>
  );
}
