'use client';

import { Button, Input, Label } from '@valuebooks/ui';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { AppleMark, GoogleMark } from './auth-social-marks';
import { apiRequest, ApiError } from '../lib/api';
import { formValue } from '../lib/forms';

type AuthMode = 'login' | 'signup' | 'forgot' | 'reset';

const modeConfig: Record<AuthMode, { endpoint: string; submit: string; busy: string }> = {
  login: { endpoint: '/auth/login', submit: 'Sign in', busy: 'Signing in' },
  signup: { endpoint: '/auth/signup', submit: 'Create account', busy: 'Creating account' },
  forgot: { endpoint: '/auth/forgot-password', submit: 'Send reset link', busy: 'Sending link' },
  reset: {
    endpoint: '/auth/reset-password',
    submit: 'Set new password',
    busy: 'Updating password',
  },
};

export function AuthForm({
  mode,
  token,
  invitation,
  redirectTo = '/dashboard',
  socialOptions = true,
}: {
  mode: AuthMode;
  token?: string;
  /** Set when the visitor arrived from an organization invitation link. */
  invitation?: string;
  /**
   * Where a successful sign-in lands. The customer portal is a separate surface with its own
   * sign-in page, and its visitors are not organization members -- sending them to the internal
   * dashboard bounced them straight into onboarding for a business they do not work for.
   */
  redirectTo?: string;
  /**
   * Set false on the customer portal, whose visitors are invoice recipients rather than ValueBooks
   * account holders -- offering them a social account to create would misdescribe the flow.
   */
  socialOptions?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [complete, setComplete] = useState(false);
  const config = modeConfig[mode];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors([]);
    const data = new FormData(event.currentTarget);
    const email = formValue(data, 'email');
    const body =
      mode === 'signup'
        ? { email, password: data.get('password') }
        : mode === 'reset'
          ? { token, password: data.get('password') }
          : mode === 'forgot'
            ? { email }
            : { email, password: data.get('password') };

    try {
      const response = await apiRequest<{ data?: { user?: { profileComplete?: boolean } } }>(
        config.endpoint,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (mode === 'login') {
        const destination = invitation
          ? `/accept-invitation?token=${encodeURIComponent(invitation)}`
          : redirectTo;
        router.push(
          response.data?.user?.profileComplete === false
            ? `/complete-profile?next=${encodeURIComponent(destination)}`
            : destination,
        );
        router.refresh();
        return;
      }
      if (mode === 'reset') {
        router.push('/login?reset=success');
        return;
      }
      setSubmittedEmail(email);
      setComplete(true);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('We could not reach ValueBooks. Check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  if (complete) {
    return (
      <div className="rb-auth-success" role="status">
        <span>
          <MailCheck aria-hidden="true" />
        </span>
        <h2>{mode === 'signup' ? 'Check your inbox' : 'Reset link requested'}</h2>
        <p>
          {mode === 'signup'
            ? invitation
              ? `We sent the next step to ${submittedEmail}. Verify your email, then open your invitation link again to join.`
              : `We sent the next step to ${submittedEmail}. Verify your email before creating your organization.`
            : `If an account matches ${submittedEmail}, a secure reset link will arrive shortly.`}
        </p>
        <Button asChild variant="outline">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <form className="rb-auth-form" onSubmit={(event) => void submit(event)} noValidate>
        {mode !== 'reset' ? (
          <div className="rb-auth-field">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              inputMode="email"
            />
          </div>
        ) : null}

        {mode === 'login' || mode === 'signup' || mode === 'reset' ? (
          <div className="rb-auth-field">
            <div className="rb-auth-field__label-row">
              <Label htmlFor="password">{mode === 'reset' ? 'New password' : 'Password'}</Label>
            </div>
            <Input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'login' ? 1 : 12}
              maxLength={128}
              aria-describedby={mode === 'signup' || mode === 'reset' ? 'password-hint' : undefined}
            />
            <div className="rb-auth-field__hint-row">
              {mode === 'signup' || mode === 'reset' ? (
                <span id="password-hint">
                  Use 12+ characters with uppercase, lowercase, and a number.
                </span>
              ) : mode === 'login' ? (
                <Link href="/forgot-password">Forgot it?</Link>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}
        {fieldErrors.length ? (
          <ul className="rb-auth-field-errors" aria-label="Field errors">
            {fieldErrors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}

        <Button className="rb-auth-form__submit" size="lg" type="submit" loading={loading}>
          {loading ? config.busy : config.submit}
        </Button>

        {socialOptions && (mode === 'login' || mode === 'signup') ? (
          <>
            <div className="rb-auth-divider">
              <span>or</span>
            </div>
            <div className="rb-auth-social">
              <button type="button" disabled aria-describedby="social-note" data-provider="google">
                <GoogleMark />
                {mode === 'login' ? 'Sign in with Google' : 'Sign up with Google'}
              </button>
              <button type="button" disabled aria-describedby="social-note" data-provider="apple">
                <AppleMark />
                {mode === 'login' ? 'Sign in with Apple' : 'Sign up with Apple'}
              </button>
              <p className="rb-auth-social__note" id="social-note">
                Social sign-in is coming soon.
              </p>
            </div>
          </>
        ) : null}
      </form>

      <p className="rb-auth-form__switch">
        {mode === 'login' ? (
          <>
            New to ValueBooks? <Link href="/signup">Create an account</Link>
          </>
        ) : null}
        {mode === 'signup' ? (
          <>
            Already have an account? <Link href="/login">Sign in now.</Link>
          </>
        ) : null}
        {mode === 'forgot' || mode === 'reset' ? (
          <Link href="/login">Return to sign in</Link>
        ) : null}
      </p>
    </>
  );
}
