'use client';

import { Button, Input, Label } from '@valuebooks/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/onboarding';
}

export function CompleteProfileClient({ next }: { next: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = useRef<HTMLInputElement>(null);
  const destination = safeNext(next);

  useEffect(() => {
    void apiRequest<{ data: { profileComplete: boolean } }>('/me')
      .then((response) => {
        if (response.data.profileComplete) router.replace(destination);
      })
      .catch(() => router.replace('/login'));
  }, [destination, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const displayName = new FormData(event.currentTarget).get('displayName');
    try {
      await apiRequest('/auth/profile', { method: 'PATCH', body: JSON.stringify({ displayName }) });
      router.replace(destination);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'We could not save your name. Try again.',
      );
      name.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="rb-auth-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="rb-auth-field">
        <Label htmlFor="displayName">Your name</Label>
        <Input
          ref={name}
          id="displayName"
          name="displayName"
          autoComplete="name"
          required
          minLength={2}
          maxLength={120}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'profile-error' : undefined}
        />
      </div>
      {error ? (
        <p className="rb-auth-error" id="profile-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="rb-auth-form__submit" size="lg" type="submit" loading={loading}>
        Continue
      </Button>
    </form>
  );
}
