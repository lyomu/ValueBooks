'use client';

import { Badge, Button, EmptyState, Skeleton } from '@valuebooks/ui';
import { Laptop, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';

import { apiRequest, ApiError } from '../lib/api';

interface Session {
  id: string;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

interface MfaStatus {
  enabled: boolean;
  email: string;
  enabledAt: string | null;
}

export function SecuritySessions() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mfa, setMfa] = useState<MfaStatus | null>(null);
  const [mfaCodePending, setMfaCodePending] = useState(false);

  async function load() {
    try {
      const response = await apiRequest<{ data: Session[] }>('/auth/sessions');
      setSessions(response.data);
      const status = await apiRequest<{ data: MfaStatus }>('/auth/mfa');
      setMfa(status.data);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.replace('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Sessions could not be loaded.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(session: Session) {
    setBusyId(session.id);
    try {
      await apiRequest(`/auth/sessions/${session.id}`, { method: 'DELETE' });
      if (session.current) {
        router.replace('/login');
        router.refresh();
      } else {
        setSessions((current) => current?.filter(({ id }) => id !== session.id) ?? []);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The session could not be revoked.');
    } finally {
      setBusyId(null);
    }
  }

  async function revokeOthers() {
    setBusyId('others');
    try {
      await apiRequest('/auth/sessions/others', { method: 'DELETE' });
      setSessions((current) => current?.filter(({ current: isCurrent }) => isCurrent) ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Other sessions could not be revoked.');
    } finally {
      setBusyId(null);
    }
  }

  async function startMfaEnrollment() {
    setBusyId('mfa');
    setError(null);
    try {
      await apiRequest('/auth/mfa/enroll', { method: 'POST' });
      setMfaCodePending(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Email verification could not be started.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId('mfa');
    setError(null);
    try {
      const code = new FormData(event.currentTarget).get('code');
      await apiRequest('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ code }) });
      setMfaCodePending(false);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The verification code could not be checked.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function resendMfa() {
    setBusyId('mfa');
    setError(null);
    try {
      await apiRequest('/auth/mfa/resend', { method: 'POST' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'A new code could not be sent.');
    } finally {
      setBusyId(null);
    }
  }

  async function disableMfa() {
    setBusyId('mfa');
    setError(null);
    try {
      await apiRequest('/auth/mfa', { method: 'DELETE' });
      router.replace('/login');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Email verification could not be disabled.',
      );
    } finally {
      setBusyId(null);
    }
  }

  if (!sessions && !error) {
    return (
      <div className="rb-security-loading" aria-label="Loading active sessions">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="rb-security-stack">
      <section className="rb-security-section" aria-labelledby="active-sessions-title">
        <div className="rb-security-section__header">
          <div>
            <h2 id="active-sessions-title">Active sessions</h2>
            <p>Review devices that are currently signed in to your account.</p>
          </div>
          {(sessions?.length ?? 0) > 1 ? (
            <Button
              variant="outline"
              onClick={() => void revokeOthers()}
              loading={busyId === 'others'}
            >
              <LogOut aria-hidden="true" /> Sign out other sessions
            </Button>
          ) : null}
        </div>
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}
        {sessions?.length ? (
          <ul className="rb-session-list">
            {sessions.map((session) => {
              const mobile = /Android|iPhone|iPad|Mobile/i.test(session.userAgent ?? '');
              return (
                <li key={session.id}>
                  <span className="rb-session-list__icon">
                    {mobile ? <Smartphone aria-hidden="true" /> : <Laptop aria-hidden="true" />}
                  </span>
                  <div className="rb-session-list__copy">
                    <div>
                      <strong>{describeDevice(session.userAgent)}</strong>
                      {session.current ? <Badge tone="success">This device</Badge> : null}
                    </div>
                    <span>
                      Last active {formatDate(session.lastSeenAt)} · Signed in{' '}
                      {formatDate(session.createdAt)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => void revoke(session)}
                    loading={busyId === session.id}
                  >
                    Sign out
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : !error ? (
          <EmptyState
            title="No active sessions"
            description="Sign in again to create a new secure session."
            icon={ShieldCheck}
          />
        ) : null}
      </section>

      <section className="rb-security-section" aria-labelledby="mfa-title">
        <div className="rb-security-section__header">
          <div>
            <h2 id="mfa-title">Email verification</h2>
            <p>
              An optional emailed code after your password and before sensitive account actions.
            </p>
          </div>
          <Badge tone={mfa?.enabled ? 'success' : 'neutral'}>
            {mfa?.enabled ? 'Enabled' : 'Optional'}
          </Badge>
        </div>
        <div className="rb-security-note">
          {mfaCodePending ? (
            <form className="rb-inline-verification" onSubmit={(event) => void verifyMfa(event)}>
              <label htmlFor="security-email-code">
                Enter the 8-digit code sent to {mfa?.email ?? 'your email'}.
              </label>
              <input
                id="security-email-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{8}"
                minLength={8}
                maxLength={8}
                required
              />
              <Button type="submit" loading={busyId === 'mfa'}>
                Verify email
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void resendMfa()}
                disabled={busyId === 'mfa'}
              >
                Resend code
              </Button>
            </form>
          ) : mfa?.enabled ? (
            <div className="rb-inline-verification">
              <span>
                Enabled for {mfa.email}. This is email verification, not a phishing-resistant MFA
                factor.
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() => void disableMfa()}
                loading={busyId === 'mfa'}
              >
                Disable
              </Button>
            </div>
          ) : (
            <div className="rb-inline-verification">
              <span>
                Email codes provide an extra check, but are weaker than authenticator apps or
                passkeys.
              </span>
              <Button
                type="button"
                onClick={() => void startMfaEnrollment()}
                loading={busyId === 'mfa'}
              >
                Enable email verification
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown browser';
  const browser = userAgent.includes('Edg/')
    ? 'Microsoft Edge'
    : userAgent.includes('Firefox/')
      ? 'Firefox'
      : userAgent.includes('Chrome/')
        ? 'Chrome'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : 'Web browser';
  const system = userAgent.includes('Windows')
    ? 'Windows'
    : userAgent.includes('Mac OS')
      ? 'macOS'
      : userAgent.includes('Android')
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : 'Unknown device';
  return `${browser} on ${system}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
