import { describe, expect, it, vi } from 'vitest';

import {
  createGitHubClient,
  GitHubAuthenticationError,
  GitHubRateLimitError,
  GitHubPermissionError,
  GitHubResponseError,
} from './client.js';

const response = (body: unknown, init: ResponseInit = {}, headers?: Record<string, string>) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...headers },
  });

const client = (fetcher: typeof fetch, repositories = ['owner/repo']) =>
  createGitHubClient({ token: 'test-token', repositories, fetch: fetcher });

describe('GitHub read client', () => {
  it('reads only allowlisted repositories and sends conditional, authenticated GETs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ id: 1 }, {}, { etag: 'W/"abc"' }));
    const github = client(fetcher);

    const result = await github.readRepository('owner/repo', { etag: 'W/"old"' });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.github.com/repos/owner/repo');
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-token');
    expect(new Headers(init?.headers).get('if-none-match')).toBe('W/"old"');
    expect(result).toMatchObject({ data: { id: 1 }, etag: 'W/"abc"', notModified: false });

    await expect(github.readRepository('other/private')).rejects.toThrow(/allowlist/i);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects invalid resource identifiers before transport', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response({}));
    const github = client(fetcher);
    expect(() => github.readCommit('owner/repo', 'not-a-sha')).toThrow(/SHA/i);
    expect(() => github.readIssue('owner/repo', 0)).toThrow(/number/i);
    await expect(github.readIssues('owner/repo', { cursor: '../2' })).rejects.toThrow(/cursor/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds page size and exposes only validated next-page cursors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([{ id: 1 }], {}, {
      link: '<https://api.github.com/repos/owner/repo/issues?per_page=100&page=2>; rel="next", <https://api.github.com/repos/owner/repo/issues?per_page=100&page=8>; rel="last"',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4999',
      'x-ratelimit-reset': '1795580000',
    }));
    const github = client(fetcher);

    const result = await github.readIssues('owner/repo', { limit: 500 });

    expect(new URL(fetcher.mock.calls[0]![0] as string).searchParams.get('per_page')).toBe('100');
    expect(result.nextCursor).toBe('2');
    expect(result.rateLimit).toMatchObject({ limit: 5000, remaining: 4999 });
    expect(result.rateLimit.resetAt).toBe(new Date(1795580000 * 1000).toISOString());
  });

  it('rejects untrusted pagination URLs and oversized responses', async () => {
    const badLink = vi.fn<typeof fetch>().mockResolvedValue(response([{ id: 1 }], {}, {
      link: '<https://attacker.example/steal?page=2>; rel="next"',
    }));
    await expect(client(badLink).readIssues('owner/repo')).rejects.toBeInstanceOf(GitHubResponseError);

    const oversized = vi.fn<typeof fetch>().mockResolvedValue(response({ body: 'x'.repeat(1_000_001) }));
    await expect(client(oversized).readRepository('owner/repo')).rejects.toThrow(/size limit/i);
  });

  it('returns a cache result for conditional 304 responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(null, { status: 304 }, { etag: '"same"' }));

    const result = await client(fetcher).readPullRequest('owner/repo', 42, { etag: '"same"' });

    expect(result).toMatchObject({ data: null, notModified: true, etag: '"same"' });
  });

  it('uses read-only resource paths for commits, pull requests, issues, comments, and reviews', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response([]));
    const github = client(fetcher);

    await github.readCommit('owner/repo', 'a'.repeat(40));
    await github.readPullRequest('owner/repo', 42);
    await github.readIssue('owner/repo', 42);
    await github.readIssueComments('owner/repo', 42);
    await github.readReviewComments('owner/repo', 42);
    await github.readPullRequestReviews('owner/repo', 42);

    expect(fetcher.mock.calls.map(([url, init]) => [new URL(url as string).pathname, init?.method])).toEqual([
      ['/repos/owner/repo/commits/' + 'a'.repeat(40), 'GET'],
      ['/repos/owner/repo/pulls/42', 'GET'],
      ['/repos/owner/repo/issues/42', 'GET'],
      ['/repos/owner/repo/issues/42/comments', 'GET'],
      ['/repos/owner/repo/pulls/42/comments', 'GET'],
      ['/repos/owner/repo/pulls/42/reviews', 'GET'],
    ]);
  });

  it('types authentication and rate-limit failures without exposing credentials', async () => {
    const auth = vi.fn<typeof fetch>().mockResolvedValue(response({ message: 'bad token' }, { status: 401 }));
    await expect(client(auth).readRepository('owner/repo')).rejects.toBeInstanceOf(GitHubAuthenticationError);

    const limited = vi.fn<typeof fetch>().mockResolvedValue(response({ message: 'slow down' }, { status: 403 }, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1795580000',
      'retry-after': '15',
    }));
    await expect(client(limited).readRepository('owner/repo')).rejects.toMatchObject({
      constructor: GitHubRateLimitError,
      retryAfterSeconds: 15,
    });
    const forbidden = vi.fn<typeof fetch>().mockResolvedValue(response({ message: 'private repository' }, { status: 403 }));
    await expect(client(forbidden).readRepository('owner/repo')).rejects.toBeInstanceOf(GitHubPermissionError);
    expect(String(await client(auth).readRepository('owner/repo').catch((error: unknown) => error))).not.toContain('test-token');
  });
});
