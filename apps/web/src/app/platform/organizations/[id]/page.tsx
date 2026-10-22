import type { Metadata } from 'next';

import { PlatformOrganizationDetail } from '../../../../components/platform-organization-detail';

export const metadata: Metadata = { title: 'Organization | ValueBooks platform' };

export default async function PlatformOrganizationRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <PlatformOrganizationDetail organizationId={id} />;
}
