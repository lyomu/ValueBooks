import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { InvoicesPage } from '../../../components/invoices-workbench';

export const metadata: Metadata = { title: 'Invoice | ValueBooks' };

export default async function InvoiceRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <InvoicesPage initialSelectedInvoiceId={id} />
    </AppShell>
  );
}
