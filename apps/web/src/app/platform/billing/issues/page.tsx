import type { Metadata } from 'next';

import { PlatformBillingIssues } from '../../../../components/platform-billing';

export const metadata: Metadata = { title: 'Billing issues | ValueBooks platform' };

export default function Page() {
  return <PlatformBillingIssues />;
}
