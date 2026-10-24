import { expect, test, type Page } from '@playwright/test';

import { apiGet, getActiveOrganizationId } from './lib/api-fixtures';
import { clearAuthRateLimits } from './lib/rate-limits';

const API = 'http://127.0.0.1:3401/api/v1';
const UAT_PASSWORD = 'UatValueBooks1!';

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await clearAuthRateLimits();
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

test.describe('local Platform Admin UAT: nonpayment fixtures', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(() => {
    test.skip(process.env.ALLOW_UAT_FIXTURES !== 'true', 'Requires opt-in synthetic UAT fixtures.');
    test.skip(test.info().project.name !== 'desktop', 'Mutation drill runs once on desktop.');
  });

  test('F3 and F4 appear as distinct trial states in the console', async ({ page }) => {
    await signIn(page, 'demo.admin@valuebooks.local', 'DemoValueBooks1!');
    await page.goto('/platform/billing/trials');
    await expect(page.getByRole('heading', { level: 1, name: 'Trials' })).toBeVisible();
    await page.getByLabel('Filter by state').selectOption('expiring');
    await expect(page.getByText('UAT Trial Ending Ltd')).toBeVisible();
    await page.getByLabel('Filter by state').selectOption('expired');
    await expect(page.getByText('UAT Trial Expired Ltd')).toBeVisible();
  });

  test('F4 keeps records and billing visible while refusing tenant writes', async ({ page }) => {
    await signIn(page, 'uat.f4@valuebooks.local', UAT_PASSWORD);
    const organizationId = await getActiveOrganizationId(page);
    const customers = await page.request.get(`${API}/organizations/${organizationId}/customers`);
    expect(customers.status()).toBe(200);
    const billing = await page.request.get(`${API}/organizations/${organizationId}/billing`);
    expect(billing.status()).toBe(200);
    const write = await page.request.post(`${API}/organizations/${organizationId}/customers`, {
      data: { displayName: 'UAT forbidden customer' },
    });
    expect(write.status()).toBe(403);
    const writeBody = (await write.json()) as { error: { code: string } };
    expect(writeBody.error.code).toBe('SUBSCRIPTION_READ_ONLY');
  });

  test('F6 permits invoice number 20 and refuses number 21', async ({ page }) => {
    await signIn(page, 'uat.f6@valuebooks.local', UAT_PASSWORD);
    const organizationId = await getActiveOrganizationId(page);
    const customers = await apiGet<{ data: { id: string; displayName: string }[] }>(
      page, `/organizations/${organizationId}/customers`,
    );
    const contactId = customers.data.find((row) => row.displayName === 'UAT Fixture Customer')?.id;
    expect(contactId).toBeTruthy();
    const createDraft = async () => {
      const response = await page.request.post(`${API}/organizations/${organizationId}/invoices`, {
        data: { contactId, lines: [{ description: 'UAT limit check', quantity: '1', unitPriceMinor: '10000' }] },
      });
      expect(response.status()).toBe(201);
      return ((await response.json()) as { data: { id: string } }).data.id;
    };
    const twentieth = await createDraft();
    const issued = await page.request.post(`${API}/organizations/${organizationId}/invoices/${twentieth}/issue`);
    expect(issued.status()).toBe(200);
    const twentyFirst = await createDraft();
    const blocked = await page.request.post(`${API}/organizations/${organizationId}/invoices/${twentyFirst}/issue`);
    expect(blocked.status()).toBe(403);
    const blockedBody = (await blocked.json()) as { error: unknown };
    expect(blockedBody.error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED', feature: 'invoices.issued.max', limit: 20,
    });
  });

  test('F7 permits project number 25 and refuses number 26', async ({ page }) => {
    await signIn(page, 'uat.f7@valuebooks.local', UAT_PASSWORD);
    const organizationId = await getActiveOrganizationId(page);
    const create = (name: string) => page.request.post(`${API}/organizations/${organizationId}/projects`, {
      data: { name },
    });
    const twentyFifth = await create('UAT project at limit');
    expect(twentyFifth.status()).toBe(201);
    const blocked = await create('UAT project beyond limit');
    expect(blocked.status()).toBe(403);
    const blockedBody = (await blocked.json()) as { error: unknown };
    expect(blockedBody.error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED', feature: 'projects.enabled', limit: 25,
    });
  });
});
