import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { ItemsPage } from '../../../components/catalog-workbench';

export const metadata: Metadata = { title: 'Items & services | ValueBooks' };

export default function CatalogItemsRoute() {
  return (
    <AppShell>
      <ItemsPage />
    </AppShell>
  );
}
