import type { Metadata } from 'next';

import { AuthShell } from '../../components/auth-shell';
import { CompleteProfileClient } from '../../components/complete-profile-client';

export const metadata: Metadata = { title: 'Complete your profile | ValueBooks' };

export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthShell
      title="Tell us your name"
      description="We use this to personalize your workspace and activity history."
    >
      <CompleteProfileClient next={next ?? null} />
    </AuthShell>
  );
}
