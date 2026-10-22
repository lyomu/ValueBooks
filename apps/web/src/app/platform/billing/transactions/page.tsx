import type { Metadata } from 'next';

import { PlatformBillingList } from '../../../../components/platform-billing';

export const metadata: Metadata = { title: 'Transactions | ValueBooks platform' };

export default function Page() {
  return <PlatformBillingList kind="transactions" />;
}
