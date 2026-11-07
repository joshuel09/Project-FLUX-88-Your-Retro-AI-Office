import { expect, test } from '@playwright/test';

import { expectNoA11yViolations } from '../fixtures/a11y';

/**
 * US3 e2e (T037): owner writes knowledge, finds it in keyword and semantic
 * search with attribution/status labels, inspects versions, revokes.
 * Requires the stack running (api :3001, web via E2E_BASE_URL) with a seeded DB.
 */

const OWNER = { email: 'owner@example.test', password: 'retro-office-flux-88!' };

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/v1/auth/setup', { data: OWNER }).catch(() => {});
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel(/Password/).fill(OWNER.password);
  await page.getByRole('button', { name: 'Enter the office' }).click();
  await page.waitForURL('**/clock-tower');
  await page.goto('/memory-vault');
});

test('memory vault page passes WCAG AA checks', async ({ page }) => {
  await expectNoA11yViolations(page);
});

test('owner writes knowledge, searches both modes, inspects and revokes', async ({ page }) => {
  const title = `Vault e2e ${Date.now()}`;

  await page.getByRole('button', { name: '+ Add knowledge' }).click();
  await page.locator('#mem-title').fill(title);
  await page.locator('#mem-body').fill('Retro dashboards must respect reduced motion preferences everywhere.');
  await page.getByRole('button', { name: 'Save as verified' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Knowledge saved' })).toBeVisible();

  await page.locator('#memory-query').fill('Vault e2e');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const hit = page.getByTestId('memory-hit').filter({ hasText: title }).first();
  await expect(hit).toBeVisible();
  await expect(hit.getByRole('note', { name: /Verification status/ })).toHaveText('verified');

  await page.getByRole('radio', { name: 'semantic' }).check();
  await expect(page.getByTestId('memory-hit').first()).toBeVisible();

  await page.getByTestId('memory-hit').filter({ hasText: title }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Memory entry detail' });
  await expect(dialog.getByRole('heading', { name: 'Versions' })).toBeVisible();
  await dialog.getByRole('button', { name: /Revoke/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'revoked' })).toBeVisible();

  // Revoked entries disappear from search results.
  await expect(page.getByTestId('memory-hit').filter({ hasText: title })).toHaveCount(0);
});
