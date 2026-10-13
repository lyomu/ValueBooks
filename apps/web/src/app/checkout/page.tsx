import type { Metadata } from 'next';
import { AuthShell } from '../../components/auth-shell';
import { CheckoutClient } from '../../components/checkout-client';
export const metadata: Metadata = { title: 'Checkout | ValueBooks' };
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const { intent } = await searchParams;
  return (
    <AuthShell
      title="Complete your subscription"
      description="Review your plan before setting up your organization."
    >
      {intent ? (
        <CheckoutClient intent={intent} />
      ) : (
        <p className="rb-auth-error">Choose a plan before checkout.</p>
      )}
    </AuthShell>
  );
}
