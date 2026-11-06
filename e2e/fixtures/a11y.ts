import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * WCAG 2.1 AA accessibility assertion (constitution X, SC-010).
 * Usage inside a test: await expectNoA11yViolations(page);
 */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations,
    results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join('\n'),
  ).toEqual([]);
}
