import type { Metadata } from 'next';
import { AppShell } from '../../../../components/app-shell';
import { PaymentEditorPage } from '../../../../components/payments-workbench';
export const metadata: Metadata = { title: 'Edit payment | ValueBooks' };
export default async function EditPaymentRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <PaymentEditorPage paymentId={id} />
    </AppShell>
  );
}
