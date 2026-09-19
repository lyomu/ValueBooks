import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { PaymentMadeEditorPage } from '../../../components/payments-made-workbench';

export const metadata: Metadata = { title: 'Record payment | ValueBooks' };

export default function NewPaymentMadeRoute() {
  return (
    <AppShell>
      <PaymentMadeEditorPage />
    </AppShell>
  );
}
