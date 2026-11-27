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

test('activity page lets the owner link untrusted GitHub feedback to an existing task', async ({ page }) => {
  let linked = false;
  const feedback = {
    id: 'd4aed260-78d2-44f9-a9c2-0f94436b40ca', authorLogin: 'external-reviewer',
    bodyExcerpt: '<script>untrusted note</script>', sourceUrl: 'https://github.com/acme/office/pull/42#discussion_r12',
    state: 'pending', taskId: null, taskTitle: null, assigneeAgentId: 'data', provenance: 'untrusted', receivedAt: new Date().toISOString(),
  };
  const issueComment = {
    ...feedback, id: 'd4aed260-78d2-44f9-a9c2-0f94436b40cb', externalType: 'issue_comment',
    bodyExcerpt: 'Issue comment', sourceUrl: 'https://github.com/acme/office/issues/43#issuecomment-13',
  };
  await page.route('**/api/v1/feedback**', async (route) => {
    if (route.request().method() === 'POST') {
      linked = true;
      await route.fulfill({ json: { ...feedback, state: 'linked', taskId: 'aeb8401e-1ce0-4326-ac6d-6ca9f4ceab9d', taskTitle: 'Existing task' } });
      return;
    }
    await route.fulfill({ json: { items: linked ? [{ ...feedback, state: 'linked', taskId: 'aeb8401e-1ce0-4326-ac6d-6ca9f4ceab9d', taskTitle: 'Existing task' }] : [feedback, issueComment] } });
  });
  await page.route('**/api/v1/tasks**', (route) => route.fulfill({ json: { items: [{ id: 'aeb8401e-1ce0-4326-ac6d-6ca9f4ceab9d', title: 'Existing task' }] } }));

  await page.goto('/clock-tower/activity');
  await expect(page.getByRole('heading', { name: 'GitHub review feedback' })).toBeVisible();
  await expect(page.getByText('<script>untrusted note</script>')).toBeVisible();
  await expect(page.getByText('Linking requires a GitHub pull request URL.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Link to existing task' })).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Link to existing task' }).selectOption('aeb8401e-1ce0-4326-ac6d-6ca9f4ceab9d');
  await page.getByRole('button', { name: 'Link feedback' }).click();
  await expect(page.getByText('Linked to Existing task')).toBeVisible();
  await expectNoA11yViolations(page);
});
