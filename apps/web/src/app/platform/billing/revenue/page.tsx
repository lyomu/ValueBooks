import type { Metadata } from 'next';

import { PlatformBillingRevenue } from '../../../../components/platform-billing';

export const metadata: Metadata = { title: 'Revenue analytics | ValueBooks platform' };

export default function Page() {
  return <PlatformBillingRevenue />;
}
