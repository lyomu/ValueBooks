import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { PaymentsPage } from '../../../components/payments-workbench';

export const metadata: Metadata = { title: 'Payment | ValueBooks' };

export default async function PaymentRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <PaymentsPage initialSelectedPaymentId={id} />
    </AppShell>
  );
}
