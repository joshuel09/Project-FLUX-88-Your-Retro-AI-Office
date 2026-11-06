import { expect, test } from '@playwright/test';

import { expectNoA11yViolations } from '../fixtures/a11y';

/**
 * US5 e2e (T021): login → all nine areas → 18 agents → axe → reduced motion.
 * Requires the stack running (api :3001, web via E2E_BASE_URL) with a seeded DB.
 */

const OWNER = { email: 'owner@example.test', password: 'retro-office-flux-88!' };
const AREAS = [
  'Clock Tower',
  'Hawkins Lab',
  'The Arcade',
  'The Garage',
  'Ghost Lab',
  'The Front Desk',
  'The Video Store',
  'The Mall',
  'The Memory Vault',
];

test.beforeEach(async ({ page }) => {
  // Idempotent owner setup, then UI login.
  await page.request.post('/api/v1/auth/setup', { data: OWNER }).catch(() => {});
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel(/Password/).fill(OWNER.password);
  await page.getByRole('button', { name: 'Enter the office' }).click();
  await page.waitForURL('**/clock-tower');
});

test('login page passes WCAG AA checks', async ({ page }) => {
  await page.goto('/login');
  await expectNoA11yViolations(page);
});

test('all nine office areas are reachable and accessible', async ({ page }) => {
  for (const areaName of AREAS) {
    await page.getByRole('navigation', { name: 'Office areas' }).getByRole('link', { name: areaName }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(areaName);
  }
  await expectNoA11yViolations(page);
});

test('agent directory lists exactly 18 agents with the MOCK banner visible', async ({ page }) => {
  await page.goto('/clock-tower/agents');
  await expect(page.getByTestId('agent-card')).toHaveCount(18);
  await expect(page.getByText('MOCK MODE — simulated activity only')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('agent detail shows permissions and blocks policy edits', async ({ page }) => {
  await page.goto('/clock-tower/agents/data');
  await expect(page.getByRole('heading', { level: 1, name: 'DATA', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prohibited operations' })).toBeVisible();
  await expect(page.getByText(/requires\s+an approval request/)).toBeVisible();
  await expectNoA11yViolations(page);
});

test('reduced-motion toggle disables the CRT overlay', async ({ page }) => {
  const overlay = page.locator('.crt-overlay');
  await expect(overlay).toBeVisible();
  await page.getByRole('button', { name: /Motion:/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  await expect(overlay).toBeHidden();
});
