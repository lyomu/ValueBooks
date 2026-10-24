import type { Metadata } from 'next';

import { PlatformBillingDetail } from '../../../../../components/platform-billing';

export const metadata: Metadata = { title: 'Subscription | ValueBooks platform' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlatformBillingDetail kind="subscriptions" id={id} />;
}
