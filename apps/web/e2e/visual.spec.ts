import { expect, test, type Page } from '@playwright/test';

import { clearAuthRateLimits } from './lib/rate-limits';

async function signIn(page: Page): Promise<void> {
  await clearAuthRateLimits();
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo.owner@valuebooks.local');
  await page.getByLabel('Password', { exact: true }).fill('DemoValueBooks1!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

async function openStable(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.locator('#main-content').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const button = document.querySelector('button');
    return Boolean(button && Object.keys(button).some((key) => key.startsWith('__reactProps$')));
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

function collectBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => {
    errors.push(`${request.failure()?.errorText ?? 'Request failed'} ${request.url()}`);
  });
  return errors;
}

test.describe('ValueBooks design foundation', () => {
  test('@visual authentication references', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'desktop') {
      await page.setViewportSize({ width: 2560, height: 1356 });
    }
    await openStable(page, '/signup');
    await expect(
      page.getByRole('heading', { name: 'Sign up for ValueBooks today!' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign up with Google' })).toBeDisabled();
    if (testInfo.project.name === 'desktop') {
      await expect(page.locator('html')).toHaveJSProperty('scrollHeight', 1356);
    }
    await expect(page).toHaveScreenshot('signup.png', { fullPage: true, maxDiffPixelRatio: 0.002 });

    await openStable(page, '/login');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    if (testInfo.project.name === 'desktop') {
      await expect(page.getByAltText('A hand holding payment cards')).toBeVisible();
      await expect(page.locator('html')).toHaveJSProperty('scrollHeight', 1356);
    }
    await expect(page.getByRole('link', { name: 'Forgot it?' })).toBeVisible();
    await expect(page).toHaveScreenshot('login.png', { fullPage: true, maxDiffPixelRatio: 0.002 });
  });

  test('@visual dashboard baseline and shell interactions', async ({ page }, testInfo) => {
    // The dashboard is a signed-in, data-backed page now -- not the Phase 1 static reference this
    // test was written against (which named a developer's own account). Sign in as the seeded
    // demo owner so the run is reproducible on any machine.
    await signIn(page);
    const browserErrors = collectBrowserErrors(page);
    await openStable(page, '/dashboard');
    expect(browserErrors, 'dashboard should hydrate without browser errors').toEqual([]);

    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Switch organization. Current: Karibu Retail Demo' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open profile menu for Amina Kamau' }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot('dashboard.png', { fullPage: true });

    if (testInfo.project.name === 'mobile') {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('dialog', { name: 'ValueBooks navigation' })).toBeVisible();
      await page.keyboard.press('Escape');
    } else if (testInfo.project.name === 'desktop') {
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
      await page.getByRole('button', { name: 'Expand sidebar' }).click();

      await page.keyboard.press('Control+K');
      await expect(page.getByPlaceholder('Search accounts, journals, reports...')).toBeFocused();
    } else {
      await page.keyboard.press('Control+K');
      await expect(page.getByPlaceholder('Search accounts, journals, reports...')).toBeFocused();
    }
    // The old "Preview journal" / "Check form state" demo controls left the dashboard when it
    // became data-backed; journal entry is covered by the ledger journeys instead.
    expect(browserErrors).toEqual([]);
  });

  test('@visual component catalog baseline and states', async ({ page }) => {
    // The catalog renders inside the signed-in app shell, which loads /me on mount.
    await signIn(page);
    const browserErrors = collectBrowserErrors(page);
    await openStable(page, '/design-system');
    expect(browserErrors, 'component catalog should hydrate without browser errors').toEqual([]);

    await expect(page.getByRole('heading', { name: 'Design system', exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot('design-system.png', { fullPage: true });

    await page.getByRole('tab', { name: 'Empty state' }).click();
    await expect(page.getByText('No accounts match this filter', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Error state' }).click();
    await expect(page.getByText('The account list could not be loaded.')).toBeVisible();

    await page.getByRole('button', { name: 'Open dialog' }).click();
    await expect(page.getByRole('dialog', { name: 'Close fiscal period?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep open' }).click();

    await page.getByRole('button', { name: 'Test notification' }).click();
    await expect(page.getByText('Design-system notification', { exact: true })).toBeVisible();
    expect(browserErrors).toEqual([]);
  });
});
