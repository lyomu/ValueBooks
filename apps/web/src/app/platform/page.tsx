import type { Metadata } from 'next';

import { PlatformOverview } from '../../components/platform-overview';

export const metadata: Metadata = { title: 'Platform overview | ValueBooks' };

export default function PlatformOverviewRoute() {
  return <PlatformOverview />;
}
