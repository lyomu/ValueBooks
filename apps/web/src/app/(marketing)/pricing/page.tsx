import { PricingPageContent } from '../../../components/marketing/pricing-section';
import { fetchLivePlans } from '../../../components/marketing/live-prices';

export default async function Page() {
  const plans = await fetchLivePlans();
  return <PricingPageContent plans={plans} />;
}
