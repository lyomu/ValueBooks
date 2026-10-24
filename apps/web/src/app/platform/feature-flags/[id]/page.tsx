import type { Metadata } from 'next';

import { PlatformFeatureFlagDetail } from '../../../../components/platform-catalog';

export const metadata: Metadata = { title: 'Feature flag | ValueBooks platform' };

export default async function PlatformFeatureFlagRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <PlatformFeatureFlagDetail flagId={id} />;
}
