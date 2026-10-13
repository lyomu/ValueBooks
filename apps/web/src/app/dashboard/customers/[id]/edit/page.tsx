import type { Metadata } from 'next';

import { AppShell } from '../../../../../components/app-shell';
import { CustomerEditorPage } from '../../../../../components/customers-workbench';

export const metadata: Metadata = { title: 'Edit customer | ValueBooks' };

export default async function EditCustomerRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <CustomerEditorPage customerId={id} />
    </AppShell>
  );
}
