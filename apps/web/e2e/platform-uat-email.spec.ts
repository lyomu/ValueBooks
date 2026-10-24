import { expect, test, type Page } from '@playwright/test';

import { apiPost, getActiveOrganizationId } from './lib/api-fixtures';
import { clearAuthRateLimits } from './lib/rate-limits';

async function signIn(page: Page, email: string, password: string) {
  await clearAuthRateLimits();
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

test.describe('local Platform Admin UAT: F15 failed email job', () => {
  test.beforeEach(() => {
    test.skip(process.env.ALLOW_UAT_FIXTURES !== 'true', 'Requires opt-in synthetic UAT fixtures.');
    test.skip(process.env.UAT_F15_SMTP_HOST !== 'invalid.invalid', 'Run this file alone to start its worker with invalid SMTP.');
    test.skip(test.info().project.name !== 'desktop', 'Mutation drill runs once on desktop.');
  });

  test('retains a failed quote email job without exposing the message contents', async ({ page }) => {
    // BullMQ's exponential backoff across 5 attempts against an unreachable host takes well over
    // the default 30s test timeout before the job is moved to the failed queue; the assertion's
    // own 90s budget below needs the test itself given enough room to reach it.
    test.setTimeout(120_000);
    await signIn(page, 'uat.f6@valuebooks.local', 'UatValueBooks1!');
    const organizationId = await getActiveOrganizationId(page);
    const customer = await apiPost<{ data: { id: string } }>(page,
      `/organizations/${organizationId}/customers`, { displayName: 'UAT F15 Recipient', email: 'uat-f15@example.test' });
    const quote = await apiPost<{ data: { id: string } }>(page,
      `/organizations/${organizationId}/quotes`, { contactId: customer.data.id,
        lines: [{ description: 'UAT email delivery', quantity: '1', unitPriceMinor: '1000' }] });
    await apiPost(page, `/organizations/${organizationId}/quotes/${quote.data.id}/submit`);
    await apiPost(page, `/organizations/${organizationId}/quotes/${quote.data.id}/approve`);
    await apiPost(page, `/organizations/${organizationId}/quotes/${quote.data.id}/send`);
    await page.context().clearCookies();
    await signIn(page, 'demo.admin@valuebooks.local', 'DemoValueBooks1!');
    // The retained-failures panel fetches once on mount with no live polling, so waiting on the
    // already-rendered page never sees the job land; reload on each attempt until the worker has
    // exhausted its retries against the invalid host and the panel's next mount picks it up.
    await expect.poll(async () => {
      await page.goto('/platform/jobs');
      await page.getByRole('tab', { name: 'Email queue' }).click();
      return page.getByRole('table', { name: /Retained failures in the emails queue/ }).innerText();
    }, { timeout: 90_000, intervals: [2_000] }).toMatch(/quote/i);
    await expect(page.getByText('job contents are not shown')).toBeVisible();
  });
});
