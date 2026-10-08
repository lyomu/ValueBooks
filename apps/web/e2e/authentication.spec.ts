import { expect, test, type Page } from '@playwright/test';

async function openAuth(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.locator('#main-content').waitFor();
}

test.describe('authentication journeys', () => {
  test('reveals the password and clearly explains unavailable providers', async ({ page }) => {
    await openAuth(page, '/login');

    const password = page.getByRole('textbox', { name: 'Password' });
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
    await expect(page.getByText('Social sign-in is coming soon.')).toBeVisible();
  });

  test('associates validation errors with inputs and recovers after a valid signup', async ({
    page,
  }) => {
    let attempts = 0;
    await page.route('**/api/v1/auth/signup', async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              message: 'Please correct the highlighted fields.',
              fieldErrors: ['email must be an email', 'password must be at least 12 characters'],
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ data: { message: 'Check your email for the next step.' } }),
      });
    });

    await openAuth(page, '/signup');
    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByRole('textbox', { name: 'Password' }).fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.locator('.rb-auth-error[role="alert"]')).toContainText(
      'Please correct the highlighted fields.',
    );
    await expect(page.getByLabel('Email address')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('textbox', { name: 'Password' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    await page.getByLabel('Email address').fill('person@example.com');
    await page.getByRole('textbox', { name: 'Password' }).fill('StrongerPassword12');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status')).toContainText('Check your inbox');
  });

  test('sends an incomplete invited member to profile completion before acceptance', async ({
    page,
  }) => {
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { user: { profileComplete: false } } }),
      });
    });

    await openAuth(page, '/login?invitation=invitation-token');
    await page.getByLabel('Email address').fill('invitee@example.com');
    await page.getByRole('textbox', { name: 'Password' }).fill('StrongerPassword12');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(
      /\/complete-profile\?next=%2Faccept-invitation%3Ftoken%3Dinvitation-token/,
    );
  });
});
