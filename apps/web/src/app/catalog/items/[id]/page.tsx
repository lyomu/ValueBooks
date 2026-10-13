import type { Metadata } from 'next';
import { AppShell } from '../../../../components/app-shell';
import { ItemsPage } from '../../../../components/catalog-workbench';
export const metadata: Metadata = { title: 'Item | ValueBooks' };
export default async function ItemRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <ItemsPage initialSelectedItemId={id} />
    </AppShell>
  );
}
