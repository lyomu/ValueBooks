import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { VendorCreditEditorPage } from '../../../components/vendor-credits-workbench';

export const metadata: Metadata = { title: 'New vendor credit | ValueBooks' };

export default function NewVendorCreditRoute() {
  return (
    <AppShell>
      <VendorCreditEditorPage />
    </AppShell>
  );
}
