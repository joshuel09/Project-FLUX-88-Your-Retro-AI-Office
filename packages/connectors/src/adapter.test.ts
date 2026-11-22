import { expect, it } from 'vitest';

import type { GitHubFeedback, GitHubFeedbackReader, GitHubFeedbackPage } from './index.js';

const feedback = {
  externalId: 'review-123',
  externalType: 'pull_request_review',
  repository: 'owner/repo',
  number: 42,
  authorLogin: 'reviewer',
  bodyExcerpt: 'Please handle this case.',
  sourceUrl: 'https://github.com/owner/repo/pull/42#pullrequestreview-123',
  createdAt: '2026-11-22T00:00:00.000Z',
  updatedAt: '2026-11-22T00:00:00.000Z',
  provenance: 'untrusted',
} satisfies GitHubFeedback;

const page = {
  items: [feedback],
  nextCursor: 'page-2',
  etag: 'W/"abc123"',
  rateLimit: { limit: 5000, remaining: 4990, resetAt: '2026-11-22T01:00:00.000Z' },
} satisfies GitHubFeedbackPage;

const reader: GitHubFeedbackReader = {
  provider: 'github',
  async readFeedback(request) {
    expect(request.repositories).toEqual(['owner/repo']);
    expect(request.limit).toBe(50);
    return page;
  },
};

it('returns normalized feedback with a cursor and rate-limit metadata', async () => {
  const result = await reader.readFeedback({ repositories: ['owner/repo'], limit: 50 });

  expect(result).toEqual(page);
  expect(result.items[0]?.provenance).toBe('untrusted');
});
