import type { Metadata } from 'next';

import { PlatformBillingList } from '../../../../components/platform-billing';

export const metadata: Metadata = { title: 'Trials | ValueBooks platform' };

export default function Page() {
  return <PlatformBillingList kind="trials" />;
}
