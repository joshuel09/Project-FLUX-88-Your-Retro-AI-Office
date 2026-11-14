import { expect, test } from '@playwright/test';

import { expectNoA11yViolations } from '../fixtures/a11y';

declare global {
  interface Window {
    releaseGateTaskEvents: Array<{ taskId?: string; status?: string }>;
    releaseGateEventSource: EventSource;
  }
}

const OWNER = { email: 'owner@example.test', password: 'retro-office-flux-88!' };
const OFFICE_AREAS = [
  { path: '/clock-tower', heading: 'Clock Tower' },
  { path: '/hawkins-lab', heading: 'Hawkins Lab' },
  { path: '/arcade', heading: 'The Arcade' },
  { path: '/garage', heading: 'The Garage' },
  { path: '/ghost-lab', heading: 'Ghost Lab' },
  { path: '/front-desk', heading: 'The Front Desk' },
  { path: '/video-store', heading: 'The Video Store' },
  { path: '/mall', heading: 'The Mall' },
  { path: '/memory-vault', heading: 'The Memory Vault' },
];
const DASHBOARD_ROUTES = [
  { path: '/clock-tower/activity', heading: 'Activity Feed' },
  { path: '/clock-tower/agents', heading: 'Agent Directory' },
  { path: '/clock-tower/agents/data', heading: 'DATA' },
  { path: '/clock-tower/approvals', heading: 'Approval Inbox' },
  { path: '/clock-tower/audit', heading: 'Notifications & Audit History' },
  { path: '/clock-tower/integrations', heading: 'Integrations Health' },
  { path: '/clock-tower/tasks', heading: 'Task Board' },
  { path: '/front-desk/budgets', heading: 'Agent Budgets' },
];

test('login page passes axe checks', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'FLUX-88' })).toBeVisible();
  await expectNoA11yViolations(page);
});

test.describe('release gate accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.post('/api/v1/auth/setup', { data: OWNER }).catch(() => {});
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel(/Password/).fill(OWNER.password);
    await page.getByRole('button', { name: 'Enter the office' }).click();
    await page.waitForURL('**/clock-tower');
  });

  test('all nine office areas pass axe checks', async ({ page }) => {
    for (const route of OFFICE_AREAS) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1, name: route.heading, exact: true })).toBeVisible();
      await expectNoA11yViolations(page);
    }
  });

  test('all operational dashboard routes pass axe checks', async ({ page }) => {
    for (const route of DASHBOARD_ROUTES) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1, name: route.heading, exact: true })).toBeVisible();
      await expectNoA11yViolations(page);
    }
  });

  test('delegation view shows generated subtasks, dependency graph, and handoff timeline', async ({ page }) => {
    test.setTimeout(60_000);
    const title = `T055 ${Date.now()} Research 80s competitor dashboards, implement the comparison view, and test it`;
    await page.goto('/clock-tower/tasks');
    await page.evaluate(() => {
      window.releaseGateTaskEvents = [];
      window.releaseGateEventSource = new EventSource('/api/v1/events');
      window.releaseGateEventSource.addEventListener('task', (event) => {
        window.releaseGateTaskEvents.push(JSON.parse((event as MessageEvent).data) as { taskId?: string; status?: string });
      });
      return new Promise<void>((resolve, reject) => {
        window.releaseGateEventSource.onopen = () => resolve();
        window.releaseGateEventSource.onerror = () => reject(new Error('Task event stream did not connect'));
        setTimeout(() => reject(new Error('Task event stream open timed out')), 5_000);
      });
    });
    await page.locator('#task-title').fill(title);
    const createTaskResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/tasks') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Delegate' }).click();
    const createdTask = await (await createTaskResponse).json() as { id: string };
    await expect.poll(
      () => page.evaluate((taskId) => window.releaseGateTaskEvents.some((event) => event.taskId === taskId && event.status === 'completed'), createdTask.id),
      { timeout: 30_000 },
    ).toBe(true);

    const completedTask = page
      .getByRole('listitem', { name: 'completed column' })
      .getByTestId('task-card')
      .filter({ hasText: title });
    await expect(completedTask).toBeVisible({ timeout: 30_000 });
    await expect(completedTask).toContainText('3 subtasks');
    await completedTask.click();

    const drawer = page.getByRole('dialog', { name: 'Task detail' });
    await expect(drawer.locator('section[aria-labelledby="subtasks-title"] li')).toHaveCount(3);
    const dependencyGraph = drawer.getByRole('list', { name: 'Task dependency graph' });
    await expect(dependencyGraph.locator('li')).toHaveCount(2);
    await expect(drawer.getByRole('list', { name: 'Delegation timeline' })).toContainText('orchestrator.decomposed');
    await expectNoA11yViolations(page);
  });
});
