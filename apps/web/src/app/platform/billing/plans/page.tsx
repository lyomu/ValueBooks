import type { Metadata } from 'next';

import { PlatformPlanCatalog } from '../../../../components/platform-plan-catalog';

export const metadata: Metadata = { title: 'Subscription Plans | ValueBooks platform' };

export default function Page() {
  return <PlatformPlanCatalog />;
}
