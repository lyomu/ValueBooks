import type { Metadata } from 'next';

import { AuthShell } from '../../components/auth-shell';
import { SignupOtpForm } from '../../components/signup-otp-form';

export const metadata: Metadata = { title: 'Verify your email | ValueBooks' };

export default async function VerifyEmailCodePage({ searchParams }: { searchParams: Promise<{ email?: string; intent?: string }> }) {
  const { email = '', intent } = await searchParams;
  return <AuthShell title="Verify your email" description="Enter the secure code we sent before continuing to your plan."><SignupOtpForm email={email} intent={intent} /></AuthShell>;
}
