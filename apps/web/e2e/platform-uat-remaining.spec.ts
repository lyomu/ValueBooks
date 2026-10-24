import { expect, test, type Page } from '@playwright/test';

import { clearAuthRateLimits } from './lib/rate-limits';

async function signIn(page: Page, email: string, password: string) {
  await clearAuthRateLimits();
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // A membership-less account does not land on the Dashboard, so wait for navigation away from
  // /login itself rather than for a destination heading that only some accounts reach.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe('local Platform Admin UAT: remaining identity and onboarding fixtures', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(() => {
    test.skip(process.env.ALLOW_UAT_FIXTURES !== 'true', 'Requires opt-in synthetic UAT fixtures.');
    test.skip(test.info().project.name !== 'desktop', 'Fixture drill runs once on desktop.');
  });

  test('F1: a user without membership is visible to support and cannot enter the platform console', async ({ page }) => {
    await signIn(page, 'uat.f1@valuebooks.local', 'UatValueBooks1!');
    await page.goto('/platform');
    await expect(page.getByRole('heading', { name: 'You do not have platform access' })).toBeVisible();
    await page.context().clearCookies();
    await signIn(page, 'demo.admin@valuebooks.local', 'DemoValueBooks1!');
    await page.goto('/platform/users');
    await page.getByRole('textbox', { name: 'Search users' }).fill('uat.f1@valuebooks.local');
    await expect(page.getByText('uat.f1@valuebooks.local')).toBeVisible();
    await page.getByRole('link', { name: /UAT F1 No Membership/ }).click();
    await expect(page.getByText('No organization memberships')).toBeVisible();
  });

  test('F2: an unfinished organization stays in the setup filter', async ({ page }) => {
    await signIn(page, 'demo.admin@valuebooks.local', 'DemoValueBooks1!');
    await page.goto('/platform/organizations');
    await page.getByLabel('Setup').selectOption('INCOMPLETE');
    await expect(page.getByRole('link', { name: 'UAT Partial Setup Ltd' })).toBeVisible();
    await page.getByRole('link', { name: 'UAT Partial Setup Ltd' }).click();
    await expect(page.getByText('DRAFT', { exact: true }).first()).toBeVisible();
  });

  test('F12: cancellation stops renewal while paid access remains until the period end', async ({ page }) => {
    await signIn(page, 'uat.f12@valuebooks.local', 'UatValueBooks1!');
    await page.goto('/settings/billing');
    await page.getByRole('button', { name: 'Cancel subscription' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel subscription' });
    await dialog.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(page.getByText(/cancellation scheduled|access ends/i).first()).toBeVisible();
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  });

  test('F16: repeated failed sign-ins are visible as warning evidence', async ({ page }) => {
    await clearAuthRateLimits();
    await page.goto('/login');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByLabel('Email address').fill('uat.f1@valuebooks.local');
      await page.getByLabel('Password', { exact: true }).fill('DefinitelyWrong1!');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL(/\/login/);
    }
    let limited = 0;
    for (let attempt = 3; attempt < 9; attempt += 1) {
      const response = await page.request.post('http://127.0.0.1:3401/api/v1/auth/login', {
        data: { email: 'uat.f1@valuebooks.local', password: 'DefinitelyWrong1!' },
      });
      limited = response.status();
    }
    expect(limited).toBe(429);
    await page.context().clearCookies();
    await signIn(page, 'demo.admin@valuebooks.local', 'DemoValueBooks1!');
    await page.goto('/platform/security');
    await page.getByLabel('Event').selectOption('auth.login_failed');
    await expect(page.getByRole('cell', { name: /Failed sign-in attempt/ }).first()).toBeVisible();
    // Scope to the results table: the severity filter select also has a hidden "Warning" option.
    await expect(page.getByRole('table').getByText('Warning', { exact: true }).first()).toBeVisible();
  });
});
