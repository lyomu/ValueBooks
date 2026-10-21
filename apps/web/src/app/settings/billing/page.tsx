import { PageHeader } from '@valuebooks/ui';
import type { Metadata } from 'next';

import { BillingSettings } from '../../../components/billing-settings';

export const metadata: Metadata = { title: 'Billing & subscription | ValueBooks' };

export default function BillingPage() {
  return (
    <>
      <PageHeader
        title="Billing & subscription"
        description="Review your plan, trial, billing period, and payment history."
      />
      <BillingSettings />
    </>
  );
}
