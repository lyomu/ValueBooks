import { expect, test, type Page } from '@playwright/test';

import { clearAuthRateLimits } from './lib/rate-limits';

async function signIn(page: Page) {
  await clearAuthRateLimits();
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo.admin@valuebooks.local');
  await page.getByLabel('Password', { exact: true }).fill('DemoValueBooks1!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

test.describe('Platform Admin UAT viewport and keyboard sweep', () => {
  test.beforeEach(() => {
    test.skip(process.env.ALLOW_UAT_FIXTURES !== 'true', 'Requires opt-in UAT run.');
  });

  for (const path of ['/platform', '/platform/organizations', '/platform/billing/plans',
    '/platform/billing/providers', '/platform/jobs']) {
    test(`${path} fits the configured 1440, 1024, and 390 viewports`, async ({ page }) => {
      await signIn(page);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(2);
    });
  }

  test('Tab reaches visible controls; Escape closes the navigation drawer and action dialog', async ({ page }) => {
    await signIn(page);
    await page.goto('/platform/billing/plans');
    await expect(page.getByRole('heading', { level: 1, name: 'Plans & pricing' })).toBeVisible();
    // The catalog health, plan catalog and entitlement matrix panels each load asynchronously; wait
    // for the last of them (the "Create tier" action, used below) so the focusable-control count
    // captured next reflects the settled page rather than a mid-load skeleton.
    await expect(page.getByRole('button', { name: 'Create tier' })).toBeVisible();
    const focusIds = await page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea')]
        .filter((node) => !node.hasAttribute('disabled') && node.getClientRects().length > 0 &&
          getComputedStyle(node).visibility !== 'hidden');
      controls.forEach((node, index) => node.setAttribute('data-uat-focus-id', String(index)));
      return controls.map((_, index) => String(index));
    });
    const reached = new Set<string>();
    for (let index = 0; index < focusIds.length * 2 + 5; index += 1) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.getAttribute('data-uat-focus-id'));
      if (id) reached.add(id);
      if (reached.size === focusIds.length) break;
    }
    expect([...reached].sort()).toEqual([...focusIds].sort());

    if (test.info().project.name === 'mobile') {
      const menu = page.getByRole('button', { name: 'Open platform navigation' });
      await menu.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Platform navigation' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Platform navigation' })).toHaveCount(0);
    }
    const create = page.getByRole('button', { name: 'Create tier' });
    await create.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Create tier' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Create tier' })).toHaveCount(0);
  });
});
