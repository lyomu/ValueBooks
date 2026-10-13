import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { TransfersPage } from '../../../components/banking-workbench';

export const metadata: Metadata = { title: 'Transfer | ValueBooks' };

export default async function TransferRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <TransfersPage initialSelectedTransferId={id} />
    </AppShell>
  );
}
