import type { Metadata } from 'next';

import { PlatformPlanDetail } from '../../../../../components/platform-plan-detail';

export const metadata: Metadata = { title: 'Plan management | ValueBooks platform' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlatformPlanDetail tierId={id} />;
}
