import type { Metadata } from 'next';

import { PlatformBillingRefunds } from '../../../../components/platform-billing';

export const metadata: Metadata = { title: 'Refunds & adjustments | ValueBooks platform' };

export default function Page() {
  return <PlatformBillingRefunds />;
}
