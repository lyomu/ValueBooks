import type { Metadata } from 'next';

import { PlatformPlans } from '../../../components/platform-catalog';

export const metadata: Metadata = { title: 'Plans | ValueBooks platform' };

export default function PlatformPlansRoute() {
  return <PlatformPlans />;
}
