import { PlatformBillingDetail } from '../../../../../components/platform-billing';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlatformBillingDetail kind="transactions" id={id} />;
}
