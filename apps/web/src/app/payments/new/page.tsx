import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { NewPaymentPage } from '../../../components/payments-workbench';

export const metadata: Metadata = { title: 'New payment | ValueBooks' };

export default function NewPaymentRoute() {
  return (
    <AppShell>
      <NewPaymentPage />
    </AppShell>
  );
}
