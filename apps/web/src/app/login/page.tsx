import type { Metadata } from 'next';

import { AuthForm } from '../../components/auth-form';
import { AuthShell } from '../../components/auth-shell';
import { safeRedirectPath } from '../../lib/site-hosts';

export const metadata: Metadata = { title: 'Sign in | ValueBooks' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string; next?: string }>;
}) {
  const { invitation, next } = await searchParams;
  return (
    <AuthShell
      variant="split"
      title="Sign in"
      description={
        invitation ? 'Sign in with the invited email address to join the organization.' : undefined
      }
    >
      <AuthForm
        mode="login"
        invitation={invitation}
        redirectTo={safeRedirectPath(next, '/dashboard')}
      />
    </AuthShell>
  );
}
