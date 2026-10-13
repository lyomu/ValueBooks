import type { Metadata } from 'next';
import { AppShell } from '../../../../components/app-shell';
import { VendorCreditEditorPage } from '../../../../components/vendor-credits-workbench';
export const metadata: Metadata = { title: 'Edit vendor credit | ValueBooks' };
export default async function EditVendorCreditRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <VendorCreditEditorPage vendorCreditId={id} />
    </AppShell>
  );
}
