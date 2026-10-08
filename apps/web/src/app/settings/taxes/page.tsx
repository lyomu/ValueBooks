import type { Metadata } from 'next';

import { TaxCodesPage } from '../../../components/tax-workbench';

export const metadata: Metadata = { title: 'Taxes | ValueBooks' };

export default function TaxesSettingsPage() {
  return <TaxCodesPage />;
}
