import { expect, test } from '@playwright/test';

test.describe('opt-in public catalog browser pass', () => {
  test.beforeEach(() => {
    test.skip(process.env.ALLOW_UAT_FIXTURES !== 'true', 'Requires the isolated catalog fixture.');
  });

  for (const path of ['/', '/pricing']) {
    test(`${path} shows catalog cards at both billing intervals`, async ({ page }) => {
      await page.goto(path);
      const cards = page.locator('.mk-pricing-card');
      await expect(cards).toHaveCount(4);
      await expect(cards.filter({ has: page.getByRole('heading', { name: 'Professional' }) })).toContainText('/month');
      await page.getByRole('group', { name: 'Billing interval' }).getByRole('button', { name: /Yearly/ }).click();
      await expect(cards.filter({ has: page.getByRole('heading', { name: 'Professional' }) })).toContainText('billed yearly');
      await expect(cards.filter({ has: page.getByRole('heading', { name: 'Professional' }) })).toContainText('Save');
    });
  }
});
