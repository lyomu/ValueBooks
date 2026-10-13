'use client';

import { Button, Input, Label } from '@valuebooks/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';

export function SignupOtpForm({ email, intent }: { email: string; intent?: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const at = email.indexOf('@');
  const maskedEmail = at > 1 ? `${email.slice(0, 2)}${'•'.repeat(Math.max(2, at - 2))}${email.slice(at)}` : 'your email address';

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await apiRequest<{ data: { signupVerified?: boolean } }>('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ code }) });
      if (!response.data.signupVerified) throw new Error('This verification code is not for a new account.');
      router.replace(intent ? `/checkout?intent=${encodeURIComponent(intent)}` : '/pricing'); router.refresh();
    } catch (caught) { setError(caught instanceof ApiError || caught instanceof Error ? caught.message : 'We could not verify that code.'); }
    finally { setBusy(false); }
  }
  async function resend() {
    setBusy(true); setError(null);
    try { await apiRequest('/auth/mfa/resend', { method: 'POST' }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'We could not resend the code.'); }
    finally { setBusy(false); }
  }
  return <form className="rb-auth-form" onSubmit={(event) => void verify(event)} noValidate>
    <div className="rb-auth-field"><Label htmlFor="signup-code">Six-digit verification code</Label><Input id="signup-code" name="code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus /><div className="rb-auth-field__hint-row"><span>We sent a code to {maskedEmail}. It expires in 10 minutes.</span><button type="button" onClick={() => void resend()} disabled={busy}>Resend code</button></div></div>
    {error ? <div className="rb-auth-error" role="alert">{error}</div> : null}
    <Button className="rb-auth-form__submit" size="lg" type="submit" loading={busy} disabled={code.length !== 6}>Verify email</Button>
    <Link className="rb-auth-form__switch" href={intent ? `/signup?intent=${encodeURIComponent(intent)}` : '/signup'}>Use a different email</Link>
  </form>;
}
