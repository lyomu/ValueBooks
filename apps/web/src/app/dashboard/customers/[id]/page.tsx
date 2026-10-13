import type { Metadata } from 'next';

import { AppShell } from '../../../../components/app-shell';
import { CustomersPage } from '../../../../components/customers-workbench';

export const metadata: Metadata = { title: 'Customer | ValueBooks' };

export default async function CustomerRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <CustomersPage initialSelectedCustomerId={id} />
    </AppShell>
  );
}
