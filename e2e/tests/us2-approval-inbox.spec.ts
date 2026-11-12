import { expect, test } from '@playwright/test';

import { expectNoA11yViolations } from '../fixtures/a11y';

const request = {
  id: '11111111-1111-4111-8111-111111111111',
  requestingActorType: 'agent',
  requestingAgentId: 'data',
  taskId: '22222222-2222-4222-8222-222222222222',
  actionType: 'github_issue_create',
  actionPayload: { title: 'Fix retro dashboard', body: 'Add a missing approval view.' },
  targetResource: 'github/issues',
  expectedImpact: 'Create one issue in the configured repository.',
  risks: 'The issue will be visible to repository collaborators.',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  status: 'pending',
  decisionReason: '',
  decidedBy: null,
  decidedAt: null,
  batchId: null,
  dedupeKey: 'test-proposal-1',
  createdAt: new Date().toISOString(),
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/auth/me') return route.fulfill({ json: { owner: { email: 'owner@example.test' } } });
    if (url.pathname === '/api/v1/approvals' && route.request().method() === 'GET') return route.fulfill({ json: { items: [request] } });
    if (url.pathname === `/api/v1/approvals/${request.id}` && route.request().method() === 'GET') return route.fulfill({ json: request });
    if (url.pathname.startsWith(`/api/v1/approvals/${request.id}/`) && route.request().method() === 'POST') {
      return route.fulfill({ json: { request: { ...request, status: url.pathname.endsWith('/reject') ? 'rejected' : 'approved' }, grantId: '33333333-3333-4333-8333-333333333333' } });
    }
    return route.continue();
  });
  await page.goto('/clock-tower/approvals');
});

test('owner reviews full proposal and reauthenticates before approving', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Approval Inbox' })).toBeVisible();
  await expect(page.getByRole('article', { name: /github_issue_create/ })).toContainText(/\d+[ms] remaining/);
  await page.getByRole('button', { name: /Review Fix retro dashboard/ }).click();
  const detail = page.getByRole('dialog', { name: 'Approval request details' });
  await expect(detail).toContainText('The issue will be visible to repository collaborators.');
  await detail.getByRole('button', { name: 'Approve' }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm approval decision' });
  await confirm.getByLabel('Owner password').fill('owner-password');
  await confirm.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval recorded.')).toBeVisible();
});

test('reject requires a reason and owner reauthentication', async ({ page }) => {
  await page.getByRole('button', { name: /Review Fix retro dashboard/ }).click();
  const detail = page.getByRole('dialog', { name: 'Approval request details' });
  await detail.getByRole('button', { name: 'Reject' }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm rejection' });
  await confirm.getByLabel('Rejection reason').fill('Needs a narrower scope.');
  await confirm.getByLabel('Owner password').fill('owner-password');
  await confirm.getByRole('button', { name: 'Confirm rejection' }).click();
  await expect(page.getByText('Rejection recorded.')).toBeVisible();
});

test('approval inbox passes accessibility checks', async ({ page }) => {
  await expectNoA11yViolations(page);
});
