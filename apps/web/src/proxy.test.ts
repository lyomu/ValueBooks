import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveHostRedirect } from './proxy';
import { MARKETING_PATHS, safeRedirectPath } from './lib/site-hosts';

const origins = {
  marketing: 'https://valuebooks.co',
  app: 'https://next.valuebooks.co',
  console: 'https://console.valuebooks.co',
};

const route = (host: string, pathname: string, search = '') =>
  resolveHostRedirect(host, pathname, search, origins);

describe('resolveHostRedirect', () => {
  it('serves marketing pages on the marketing host', () => {
    expect(route('valuebooks.co', '/')).toBeNull();
    expect(route('valuebooks.co', '/pricing')).toBeNull();
    expect(route('valuebooks.co', '/industries/retail')).toBeNull();
  });

  it('sends auth and app paths from marketing to the app host, keeping the query', () => {
    expect(route('valuebooks.co', '/login')).toBe('https://next.valuebooks.co/login');
    expect(route('valuebooks.co', '/verify-email', '?token=abc')).toBe(
      'https://next.valuebooks.co/verify-email?token=abc',
    );
    expect(route('valuebooks.co', '/dashboard')).toBe('https://next.valuebooks.co/dashboard');
    expect(route('valuebooks.co', '/portal/accept-invitation', '?token=x')).toBe(
      'https://next.valuebooks.co/portal/accept-invitation?token=x',
    );
  });

  it('sends platform paths from any host to the console', () => {
    expect(route('valuebooks.co', '/platform/users')).toBe(
      'https://console.valuebooks.co/platform/users',
    );
    expect(route('next.valuebooks.co', '/platform')).toBe('https://console.valuebooks.co/platform');
  });

  it('serves the customer app on the app host', () => {
    expect(route('next.valuebooks.co', '/dashboard')).toBeNull();
    expect(route('next.valuebooks.co', '/settings/security')).toBeNull();
    expect(route('next.valuebooks.co', '/login')).toBeNull();
    expect(route('next.valuebooks.co', '/portal')).toBeNull();
  });

  it('redirects the app root to the dashboard and marketing paths to the marketing host', () => {
    expect(route('next.valuebooks.co', '/')).toBe('https://next.valuebooks.co/dashboard');
    expect(route('next.valuebooks.co', '/pricing', '?x=1')).toBe(
      'https://valuebooks.co/pricing?x=1',
    );
  });

  it('serves platform and sign-in pages on the console host', () => {
    expect(route('console.valuebooks.co', '/platform/billing')).toBeNull();
    expect(route('console.valuebooks.co', '/login', '?next=/platform')).toBeNull();
    expect(route('console.valuebooks.co', '/forgot-password')).toBeNull();
  });

  it('routes the rest of the console host to the right place', () => {
    expect(route('console.valuebooks.co', '/')).toBe('https://console.valuebooks.co/platform');
    expect(route('console.valuebooks.co', '/dashboard')).toBe(
      'https://next.valuebooks.co/dashboard',
    );
    expect(route('console.valuebooks.co', '/terms')).toBe('https://valuebooks.co/terms');
  });

  it('passes unknown hosts through untouched', () => {
    expect(route('127.0.0.1:3001', '/')).toBeNull();
    expect(route('localhost:3000', '/platform')).toBeNull();
    expect(route('', '/login')).toBeNull();
  });

  it('does nothing when hosts are not configured', () => {
    const none = { marketing: undefined, app: undefined, console: undefined };
    expect(resolveHostRedirect('valuebooks.co', '/login', '', none)).toBeNull();
  });

  it('does not confuse lookalike prefixes with marketing pages', () => {
    expect(route('next.valuebooks.co', '/termsheet')).toBeNull();
    expect(route('next.valuebooks.co', '/accounts')).toBeNull();
  });
});

describe('MARKETING_PATHS', () => {
  it('lists every route folder in app/(marketing)', () => {
    const folders = readdirSync(join(__dirname, 'app', '(marketing)'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `/${entry.name}`);
    for (const folder of folders) expect(MARKETING_PATHS).toContain(folder);
  });
});

describe('safeRedirectPath', () => {
  it('accepts same-site relative paths', () => {
    expect(safeRedirectPath('/platform', '/dashboard')).toBe('/platform');
  });

  it('rejects absolute, protocol-relative and missing values', () => {
    expect(safeRedirectPath('https://evil.com', '/dashboard')).toBe('/dashboard');
    expect(safeRedirectPath('//evil.com', '/dashboard')).toBe('/dashboard');
    expect(safeRedirectPath('/\\evil.com', '/dashboard')).toBe('/dashboard');
    expect(safeRedirectPath(undefined, '/dashboard')).toBe('/dashboard');
  });
});
