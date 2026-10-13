import type { Metadata } from 'next';
import { AppShell } from '../../../components/app-shell';
import { VendorsPage } from '../../../components/vendors-workbench';
export const metadata: Metadata = { title: 'Vendor | ValueBooks' };
export default async function VendorRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <VendorsPage initialSelectedVendorId={id} />
    </AppShell>
  );
}
