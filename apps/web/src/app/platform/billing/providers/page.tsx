import type { Metadata } from 'next';

import { PlatformBillingProviders } from '../../../../components/platform-billing';

export const metadata: Metadata = { title: 'Payment providers | ValueBooks platform' };

export default function Page() {
  return <PlatformBillingProviders />;
}
