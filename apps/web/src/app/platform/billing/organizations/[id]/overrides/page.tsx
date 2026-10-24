import type { Metadata } from 'next';

import { PlatformBillingOverrides } from '../../../../../../components/platform-billing';

export const metadata: Metadata = { title: 'Entitlement overrides | ValueBooks platform' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlatformBillingOverrides organizationId={id} />;
}
