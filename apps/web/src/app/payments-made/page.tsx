import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { PaymentsMadePage } from '../../components/payments-made-workbench';

export const metadata: Metadata = { title: 'Payments made | ValueBooks' };

export default function PaymentsMadeRoute() {
  return (
    <AppShell>
      <PaymentsMadePage />
    </AppShell>
  );
}
