import { defineConfig, devices } from '@playwright/test';

/**
 * E2E scaffold (T003). Suites arrive with US5 (T021).
 * Assumes the stack is running: `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev`.
 */
export default defineConfig({
  testDir: './',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
