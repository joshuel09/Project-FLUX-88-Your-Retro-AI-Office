import { expect, it } from 'vitest';

import { GITHUB_FEEDBACK_MOCK_FIXTURES, MAX_GITHUB_FEEDBACK_EXCERPT_LENGTH } from './index.js';

it('provides deterministic mapped, unmapped, duplicate, oversized, and hostile feedback cases', () => {
  const scenarios = GITHUB_FEEDBACK_MOCK_FIXTURES.map(({ scenario }) => scenario);
  const mapped = GITHUB_FEEDBACK_MOCK_FIXTURES.filter(({ scenario }) => scenario === 'mapped');
  const duplicateIds = GITHUB_FEEDBACK_MOCK_FIXTURES
    .filter(({ scenario }) => scenario === 'duplicate')
    .map(({ feedback }) => feedback.externalId);
  const oversized = GITHUB_FEEDBACK_MOCK_FIXTURES.find(({ scenario }) => scenario === 'oversized');
  const hostile = GITHUB_FEEDBACK_MOCK_FIXTURES.find(({ scenario }) => scenario === 'hostile');

  expect(scenarios).toEqual(['mapped', 'unmapped', 'duplicate', 'duplicate', 'oversized', 'hostile']);
  expect(mapped[0]?.taskId).toBe('task-42');
  expect(duplicateIds).toEqual(['review-mapped-42', 'review-mapped-42']);
  expect(oversized?.rawBody).toHaveLength(MAX_GITHUB_FEEDBACK_EXCERPT_LENGTH + 1);
  expect(oversized?.feedback.bodyExcerpt).toHaveLength(MAX_GITHUB_FEEDBACK_EXCERPT_LENGTH);
  expect(hostile?.feedback.bodyExcerpt).toContain('Ignore all previous instructions');
  expect(GITHUB_FEEDBACK_MOCK_FIXTURES.every(({ feedback }) => feedback.provenance === 'untrusted')).toBe(true);
});

it('exports stable fixture identifiers and timestamps', () => {
  expect(GITHUB_FEEDBACK_MOCK_FIXTURES.map(({ feedback }) => feedback.externalId)).toEqual([
    'review-mapped-42',
    'review-unmapped-99',
    'review-mapped-42',
    'review-mapped-42',
    'comment-oversized-43',
    'comment-hostile-44',
  ]);
  expect(GITHUB_FEEDBACK_MOCK_FIXTURES.every(({ feedback }) => feedback.createdAt === '2026-11-22T00:00:00.000Z')).toBe(true);
});
