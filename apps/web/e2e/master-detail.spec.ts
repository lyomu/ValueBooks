import { expect, test } from '@playwright/test';

import { clearAuthRateLimits } from './lib/rate-limits';

async function signIn(page: import('@playwright/test').Page) {
  await clearAuthRateLimits();
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo.owner@valuebooks.local');
  await page.getByLabel('Password', { exact: true }).fill('DemoValueBooks1!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

test.describe('master-detail records', () => {
  test('opens a semantic invoice link and preserves the selected detail on refresh', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/invoices');
    const reference = page.locator('.rb-table a[href^="/invoices/"]').first();
    await expect(reference).toBeVisible();
    await reference.click();
    await expect(page.locator('.rb-master-detail')).toBeVisible();
    const detailUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(detailUrl);
    await expect(page.locator('.rb-master-detail__detail')).toBeVisible();
  });

  test('moves selection with the keyboard and exposes a mobile list return', async ({
    page,
  }, testInfo) => {
    await signIn(page);
    await page.goto('/invoices');
    await page.locator('.rb-table a[href^="/invoices/"]').first().click();
    const firstRecord = page.locator('[id^="master-detail-record-"]').first();
    await firstRecord.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[id^="master-detail-record-"][aria-selected="true"]')).toBeFocused();
    if (testInfo.project.name === 'mobile') {
      await expect(page.getByRole('button', { name: /Back to .* list/ })).toBeVisible();
    }
  });
});
