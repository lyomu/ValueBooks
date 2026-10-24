import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

import { clearAuthRateLimits } from './lib/rate-limits';

const API = 'http://127.0.0.1:3401/api/v1';
const DATABASE_URL = process.env.E2E_DATABASE_URL ??
  'postgresql://valuebooks:valuebooks@127.0.0.1:55432/valuebooks_e2e';

async function signIn(page: Page) {
  await clearAuthRateLimits();
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo.admin@valuebooks.local');
  await page.getByLabel('Password', { exact: true }).fill('DemoValueBooks1!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

test.describe('local Platform Admin UAT: price increase notice', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(() => {
    test.skip(process.env.ALLOW_UAT_FIXTURES !== 'true', 'Requires opt-in synthetic UAT fixtures and fetch stub.');
    test.skip(test.info().project.name !== 'desktop', 'Mutation drill runs once on desktop.');
  });

  test('propose, notify, refuse inside 30 days, then publish after the ledger clock elapses', async ({ page }) => {
    const db = new Client({ connectionString: DATABASE_URL });
    await db.connect();
    try {
      // The API process uses e2e/stub-paystack.cjs. This fake code cannot reach Paystack.
      await db.query(`UPDATE plans SET provider_price_id = 'PLN_uatgrowth' WHERE key = 'growth_monthly'`);
      await signIn(page);
      await page.goto('/platform/billing/plans');
      await page.getByRole('button', { name: 'Change the price of growth_monthly' }).click();
      const proposal = page.getByRole('dialog', { name: 'Propose a new price' });
      await proposal.getByLabel('New price in USD').fill('5.99');
      await proposal.getByLabel('Reason').fill('UAT review of the notice and publication window.');
      await proposal.getByRole('button', { name: 'Propose price' }).click();
      await expect(page.getByRole('status')).toContainText('awaiting publication');

      await page.getByRole('button', { name: 'Send the price-increase notice for growth_monthly' }).click();
      const notice = page.getByRole('dialog', { name: 'Send the price-increase notice' });
      await notice.getByLabel('Reason').fill('Notify the current Growth subscribers in UAT.');
      await notice.getByRole('button', { name: 'Send notice' }).click();
      await expect(page.getByRole('status')).toContainText('notice');

      const catalog = await page.request.get(`${API}/platform/plans`);
      const plans = (await catalog.json()) as { data: Array<{ id: string; key: string;
        pendingPriceChange: { id: string } | null }> };
      const plan = plans.data.find((row) => row.key === 'growth_monthly');
      expect(plan?.pendingPriceChange?.id).toBeTruthy();
      const changeId = plan!.pendingPriceChange!.id;
      await page.getByRole('button', { name: 'Publish the proposed price for growth_monthly' }).click();
      const publish = page.getByRole('dialog', { name: 'Publish this price' });
      await expect(publish.getByText(/inside the 30-day period/i)).toBeVisible();
      await expect(publish.getByRole('button', { name: 'Publish price' })).toBeDisabled();
      const refused = await page.request.post(`${API}/platform/plans/${plan!.id}/price-changes/${changeId}/publish`, { data: {} });
      expect(refused.status()).toBe(400);
      expect(await refused.text()).toContain('30');
      await page.keyboard.press('Escape');

      // A browser cannot wait 30 days. Age only this change's queued notices in the isolated DB.
      await db.query(`UPDATE billing_notices SET queued_at = NOW() - INTERVAL '31 days'
        WHERE event_key = 'billing.plan_price_increase_notice' AND source_id = $1`, [changeId]);
      const published = await page.request.post(`${API}/platform/plans/${plan!.id}/price-changes/${changeId}/publish`, { data: {} });
      expect(published.status()).toBe(201);
      const row = await db.query<{ price_minor: string | number }>(`SELECT price_minor FROM plans WHERE id = $1`, [plan!.id]);
      expect(String(row.rows[0]?.price_minor)).toBe('599');
    } finally {
      await db.end();
    }
  });
});
