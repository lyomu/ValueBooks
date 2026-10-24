import { expect, test, type Page } from '@playwright/test';

import { clearAuthRateLimits } from './lib/rate-limits';

const DEMO_PASSWORD = 'DemoValueBooks1!';
const PLATFORM_ADMIN = 'demo.admin@valuebooks.local';
const TENANT_OWNER = 'demo.owner@valuebooks.local';

async function signIn(page: Page, email: string): Promise<void> {
  await clearAuthRateLimits();
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

test.describe('Phase 12 platform console', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(() => {
    test.skip(
      test.info().project.name !== 'desktop',
      'Platform administration runs once on desktop.',
    );
  });

  test('keeps a signed-in tenant user outside the platform console', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await signIn(page, TENANT_OWNER);
    await page.goto('/platform');

    await expect(
      page.getByRole('heading', { name: 'You do not have platform access' }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Platform console' })).toHaveCount(0);
    // The console resolves the grant with /platform/me, which is a 403 by design for a non-admin,
    // and Chrome logs every failed network response as a console error. That single expected
    // message is filtered; any JavaScript exception, other console error, or 5xx still fails.
    const unexpected = errors.filter(
      (message) =>
        message !==
        'Failed to load resource: the server responded with a status of 403 (Forbidden)',
    );
    expect(unexpected).toEqual([]);
  });

  test('F13: suspends and reactivates an organization without leaving it locked out', async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await signIn(page, PLATFORM_ADMIN);
    await page.goto('/platform/organizations');

    await page.getByRole('link', { name: 'Karibu Retail Demo', exact: true }).click();
    // The detail page loads its data over the API before rendering the heading, and a cold
    // platform query can exceed Playwright's 5s default expect timeout.
    await expect(
      page.getByRole('heading', { name: 'Karibu Retail Demo', exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    // Suspension lives on the Administration tab behind AdminActionDialog: an audited reason
    // plus the organization's slug typed back as confirmation.
    await page.getByRole('tab', { name: 'Administration' }).click();
    await page.getByRole('button', { name: 'Suspend organization' }).click();
    const suspend = page.getByRole('dialog', { name: 'Suspend organization' });
    await suspend.getByLabel('Reason').fill('Phase 12 Playwright suspension check.');
    const slug = (await suspend.locator('label strong').textContent()) ?? '';
    await suspend.getByLabel(/to confirm/).fill(slug);
    await suspend.getByRole('button', { name: 'Suspend organization' }).click();
    await expect(page.getByRole('status')).toContainText('Organization suspended.', {
      timeout: 10_000,
    });
    await expect(page.getByRole('heading', { name: 'Suspended' })).toBeVisible();
    await expect(page.getByText('Phase 12 Playwright suspension check.')).toBeVisible();
    const suspendedOrganizationId = page.url().split('/').pop();

    // The member's own browser must see the suspension, not just the console badge.
    if (process.env.ALLOW_UAT_FIXTURES === 'true') {
      await page.context().clearCookies();
      await signIn(page, TENANT_OWNER);
      const blocked = await page.request.get(`http://127.0.0.1:3401/api/v1/organizations/${suspendedOrganizationId}/accounts`);
      expect(blocked.status()).toBe(403);
      expect(await blocked.text()).toContain('This organization is suspended');
      await page.context().clearCookies();
      await signIn(page, PLATFORM_ADMIN);
      await page.goto('/platform/organizations');
      await page.getByRole('link', { name: 'Karibu Retail Demo', exact: true }).click();
      await page.getByRole('tab', { name: 'Administration' }).click();
    }

    // The API treats the reactivation reason as optional; the console records one anyway so the
    // audit trail explains both directions.
    await page.getByRole('button', { name: 'Reactivate organization' }).click();
    const reactivate = page.getByRole('dialog', { name: 'Reactivate organization' });
    await reactivate.getByLabel('Reason').fill('Phase 12 Playwright reactivation check.');
    await reactivate.getByRole('button', { name: 'Reactivate organization' }).click();
    await expect(page.getByRole('status')).toContainText('Organization reactivated.', {
      timeout: 10_000,
    });
    await expect(page.getByRole('heading', { name: 'Suspended' })).toHaveCount(0);

    await page.context().clearCookies();
    await signIn(page, TENANT_OWNER);
    expect(errors).toEqual([]);
  });

  test('targets and previews a country feature flag', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    const key = `e2e.platform.flag.${Date.now()}`;
    await signIn(page, PLATFORM_ADMIN);
    await page.goto('/platform/feature-flags');

    // Phase 5.1: creation, rules and preview go through the list, dialogs and the flag detail page.
    await page.getByRole('button', { name: 'Create flag' }).click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Key').fill(key);
    await create.getByLabel('Name').fill('Phase 12 browser flag');
    await create.getByLabel('Reason').fill('Browser test of country targeting.');
    await create.getByRole('button', { name: 'Create flag' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Phase 12 browser flag' }),
    ).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: 'Add or change a rule' }).click();
    const rule = page.getByRole('dialog');
    await rule.getByLabel('Scope').selectOption('COUNTRY');
    await rule.getByLabel('Country').fill('Kenya');
    await page.getByRole('option', { name: /Kenya \(KE\)/ }).click();
    await rule.getByLabel('Reason').fill('Pilot the flag for Kenyan tenants.');
    await rule.getByRole('button', { name: 'Add rule' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Targeting rule saved.' }),
    ).toBeVisible();

    await page.getByLabel('Audience').selectOption('hypothetical');
    await page.locator('#sim-country').fill('Kenya');
    await page.getByRole('option', { name: /Kenya \(KE\)/ }).click();
    await page.getByRole('button', { name: 'Run preview' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^On for/ })).toContainText(
      /decided by the country rule/i,
      { timeout: 10_000 },
    );
    expect(errors).toEqual([]);
  });

  test('opens the investigation pages read-only, with scoped figures and readable evidence', async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await signIn(page, PLATFORM_ADMIN);

    // Phase 5.3: every queue figure names its queue, and the retained failure count is not a 24h figure.
    await page.goto('/platform/jobs');
    await expect(page.getByRole('heading', { level: 1, name: 'Jobs and queues' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Failed (retained)' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('It is not a 24-hour figure')).toBeVisible();
    await page.getByRole('tab', { name: 'Email queue' }).click();
    await expect(page.getByText('job contents are not shown')).toBeVisible();

    // Phase 5.4: readable names over raw keys; the Warning filter matches what emitters write.
    await page.goto('/platform/security');
    await expect(page.getByRole('heading', { level: 1, name: 'Security events' })).toBeVisible();
    await page.getByLabel('Event').selectOption('auth.login_succeeded');
    await expect(page.getByRole('cell', { name: /Signed in/ }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Details' }).first().click();
    await expect(page.getByRole('dialog')).toContainText('auth.login_succeeded');
    await page.keyboard.press('Escape');

    // Phase 5.5: the suspension above is in the audit log with its reason and a before/after diff.
    await page.goto('/platform/audit');
    await expect(page.getByRole('heading', { level: 1, name: 'Platform audit' })).toBeVisible();
    await page.getByLabel('Action').selectOption('platform.organization_suspended');
    await page.getByRole('button', { name: 'Details' }).first().click({ timeout: 15_000 });
    const detail = page.getByRole('dialog');
    await expect(detail).toContainText('Organization suspended');
    await expect(detail.getByRole('table', { name: 'Changed fields' })).toContainText('SUSPENDED');
    await page.keyboard.press('Escape');

    // Phase 5.2: packs are listed per code, and the fallback pack is never shown as a country.
    await page.goto('/platform/country-packs');
    await expect(page.getByText('Fallback (no jurisdiction)')).toBeVisible({ timeout: 15_000 });
    if (process.env.ALLOW_UAT_FIXTURES === 'true') {
      // F14: a published tax pack offers deprecation or a new version, never in-place mutation.
      await page.getByRole('row').filter({ hasText: 'Published' }).first().getByRole('link').click();
      await expect(page.getByRole('button', { name: 'Create version from this' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit draft' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Delete draft' })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
});
