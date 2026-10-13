import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { BillsPage } from '../../../components/bills-workbench';

export const metadata: Metadata = { title: 'Bill | ValueBooks' };

export default async function BillRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <BillsPage initialSelectedBillId={id} />
    </AppShell>
  );
}
