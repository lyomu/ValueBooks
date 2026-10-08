import { PageHeader } from '@valuebooks/ui';
import type { Metadata } from 'next';

import { CurrencySettings } from '../../../components/currency-settings';

export const metadata: Metadata = { title: 'Currencies | ValueBooks' };

export default function CurrencySettingsPage() {
  return (
    <>
      <PageHeader
        title="Currencies"
        description="Control transaction currencies and the effective rates used for posting."
      />
      <CurrencySettings />
    </>
  );
}
