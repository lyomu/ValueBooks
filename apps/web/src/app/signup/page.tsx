import type { Metadata } from 'next';

import { AuthForm } from '../../components/auth-form';
import { AuthShell } from '../../components/auth-shell';

export const metadata: Metadata = { title: 'Create account | ValueBooks' };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string }>;
}) {
  const { invitation } = await searchParams;
  return (
    <AuthShell
      variant="signup"
      title="Sign up for ValueBooks today!"
      description={
        invitation
          ? 'Use the email address your invitation was sent to. You can join the organization once it is verified.'
          : 'ValueBooks helps small businesses keep their finances clear and organized.'
      }
    >
      <AuthForm mode="signup" invitation={invitation} />
    </AuthShell>
  );
}
