import type { Metadata } from 'next';

import { PlatformBillingOverview } from '../../../components/platform-billing-overview';

export const metadata: Metadata = { title: 'Billing overview | ValueBooks platform' };

export default function Page() {
  return <PlatformBillingOverview />;
}
