const API_ORIGIN = 'https://api.github.com';
const MAX_PAGE_SIZE = 100;
const MAX_RESPONSE_BYTES = 1_000_000;

export interface GitHubReadOptions {
  readonly etag?: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface GitHubReadResult<T> {
  readonly data: T | null;
  readonly notModified: boolean;
  readonly etag?: string;
  readonly nextCursor?: string;
  readonly rateLimit: {
    readonly limit: number;
    readonly remaining: number;
    readonly resetAt: string;
    readonly retryAfterSeconds?: number;
  };
}

export interface GitHubApiUser {
  readonly id: number;
  readonly login: string;
}

export interface GitHubApiRepository {
  readonly id: number;
  readonly full_name: string;
  readonly html_url: string;
}

export interface GitHubApiCommit {
  readonly sha: string;
  readonly html_url: string;
  readonly author: GitHubApiUser | null;
  readonly commit: { readonly message: string; readonly author: { readonly date: string } | null };
}

export interface GitHubApiIssue {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly html_url: string;
  readonly user: GitHubApiUser | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface GitHubApiPullRequest extends GitHubApiIssue {
  readonly head: { readonly sha: string };
  readonly base: { readonly sha: string };
}

export interface GitHubApiComment {
  readonly id: number;
  readonly body: string;
  readonly html_url: string;
  readonly user: GitHubApiUser | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface GitHubApiReview {
  readonly id: number;
  readonly body: string;
  readonly html_url: string;
  readonly user: GitHubApiUser | null;
  readonly state: string;
  readonly submitted_at: string | null;
}

export interface GitHubClientOptions {
  readonly token: string;
  readonly repositories: readonly string[];
  readonly fetch?: typeof fetch;
}

export class GitHubClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = new.target.name;
  }
}

export class GitHubAuthenticationError extends GitHubClientError {
  constructor() { super('GitHub authentication failed', 401); }
}

export class GitHubPermissionError extends GitHubClientError {
  constructor() { super('GitHub denied access to the requested resource', 403); }
}

export class GitHubRateLimitError extends GitHubClientError {
  constructor(readonly retryAfterSeconds?: number, readonly resetAt?: string, status = 403) {
    super('GitHub rate limit reached', status);
  }
}

export class GitHubResponseError extends GitHubClientError {
  constructor(message: string, status?: number) { super(message, status); }
}

export interface GitHubReadClient {
  readRepository(repository: string, options?: GitHubReadOptions): Promise<GitHubReadResult<GitHubApiRepository>>;
  readCommit(repository: string, sha: string, options?: GitHubReadOptions): Promise<GitHubReadResult<GitHubApiCommit>>;
  readPullRequest(repository: string, number: number, options?: GitHubReadOptions): Promise<GitHubReadResult<GitHubApiPullRequest>>;
  readIssue(repository: string, number: number, options?: GitHubReadOptions): Promise<GitHubReadResult<GitHubApiIssue>>;
  readIssues(repository: string, options?: GitHubReadOptions): Promise<GitHubReadResult<readonly GitHubApiIssue[]>>;
  readIssueComments(repository: string, number: number, options?: GitHubReadOptions): Promise<GitHubReadResult<readonly GitHubApiComment[]>>;
  readReviewComments(repository: string, number: number, options?: GitHubReadOptions): Promise<GitHubReadResult<readonly GitHubApiComment[]>>;
  readPullRequestReviews(repository: string, number: number, options?: GitHubReadOptions): Promise<GitHubReadResult<readonly GitHubApiReview[]>>;
}

const validRepository = (repository: string) => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return false;
  const [owner, name] = repository.split('/');
  return owner !== '.' && owner !== '..' && name !== '.' && name !== '..';
};

async function readBoundedBody(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GitHubResponseError('GitHub response exceeded the size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function nextPage(link: string | null, expectedPath: string): string | undefined {
  if (!link) return undefined;
  const match = /<([^>]+)>\s*;\s*rel="next"/.exec(link);
  if (!match?.[1]) return undefined;
  let next: URL;
  try {
    next = new URL(match[1]);
  } catch {
    throw new GitHubResponseError('GitHub returned an invalid pagination link');
  }
  if (next.origin !== API_ORIGIN || next.pathname !== expectedPath) {
    throw new GitHubResponseError('GitHub returned an invalid pagination link');
  }
  const page = next.searchParams.get('page');
  if (!page || !/^[1-9]\d{0,5}$/.test(page)) {
    throw new GitHubResponseError('GitHub returned an invalid pagination cursor');
  }
  return page;
}

export function createGitHubClient(options: GitHubClientOptions): GitHubReadClient {
  if (!options.token.trim()) throw new Error('GitHub token is required');
  const allowlist = new Set(options.repositories.map((repository) => {
    if (!validRepository(repository)) throw new Error('Invalid GitHub repository allowlist entry');
    return repository.toLowerCase();
  }));
  const fetcher = options.fetch ?? fetch;
  const optionsToken = options.token;

  async function request<T>(
    repository: string,
    resource: string,
    options: GitHubReadOptions = {},
    collection = false,
  ): Promise<GitHubReadResult<T>> {
    if (!validRepository(repository) || !allowlist.has(repository.toLowerCase())) {
      throw new GitHubClientError('GitHub repository is not in the configured allowlist');
    }
    if (collection && options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
      throw new GitHubClientError('GitHub page size must be a positive integer');
    }
    if (options.cursor !== undefined && !/^[1-9]\d{0,5}$/.test(options.cursor)) {
      throw new GitHubClientError('GitHub pagination cursor is invalid');
    }

    const [owner, name] = repository.split('/');
    const path = `/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}${resource ? `/${resource}` : ''}`;
    const url = new URL(path, API_ORIGIN);
    if (collection) {
      url.searchParams.set('per_page', String(Math.min(options.limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE)));
      url.searchParams.set('page', options.cursor ?? '1');
    }
    const headers = new Headers({
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${optionsToken}`,
      'x-github-api-version': '2022-11-28',
    });
    if (options.etag) headers.set('if-none-match', options.etag);

    let response: Response;
    try {
      response = await fetcher(url, { method: 'GET', headers, ...(options.signal ? { signal: options.signal } : {}) });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new GitHubClientError('GitHub request failed before a response was received');
    }

    const remainingHeader = response.headers.get('x-ratelimit-remaining');
    const remaining = Number(remainingHeader ?? 0);
    const resetEpoch = Number(response.headers.get('x-ratelimit-reset') ?? 0);
    const resetAt = Number.isFinite(resetEpoch) && resetEpoch > 0
      ? new Date(resetEpoch * 1000).toISOString()
      : new Date(0).toISOString();
    const retryValue = response.headers.get('retry-after');
    const retryHeader = retryValue === null ? Number.NaN : Number(retryValue);
    const retryAfterSeconds = Number.isFinite(retryHeader) && retryHeader >= 0 ? retryHeader : undefined;
    const rateLimit = {
      limit: Number(response.headers.get('x-ratelimit-limit') ?? 0),
      remaining,
      resetAt,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
    const etag = response.headers.get('etag') ?? undefined;
    if (response.status === 304) return { data: null, notModified: true, ...(etag ? { etag } : {}), rateLimit };
    if (response.status === 401) throw new GitHubAuthenticationError();
    if (response.status === 429 || (response.status === 403 && ((remainingHeader !== null && remaining === 0) || retryAfterSeconds !== undefined))) {
      throw new GitHubRateLimitError(retryAfterSeconds, resetAt, response.status);
    }
    if (response.status === 403) throw new GitHubPermissionError();
    if (!response.ok) throw new GitHubResponseError(`GitHub returned HTTP ${response.status}`, response.status);

    const body = await readBoundedBody(response);
    let data: T;
    try {
      data = JSON.parse(body) as T;
    } catch {
      throw new GitHubResponseError('GitHub returned invalid JSON', response.status);
    }
    if (collection && !Array.isArray(data)) throw new GitHubResponseError('GitHub returned an invalid collection response', response.status);
    const cursor = collection ? nextPage(response.headers.get('link'), path) : undefined;
    return {
      data,
      notModified: false,
      ...(etag ? { etag } : {}),
      ...(cursor ? { nextCursor: cursor } : {}),
      rateLimit,
    };
  }

  const itemPath = (kind: 'issues' | 'pulls', number: number, suffix = '') => {
    if (!Number.isInteger(number) || number < 1) throw new GitHubClientError('GitHub item number must be a positive integer');
    return `${kind}/${number}${suffix}`;
  };

  return {
    readRepository: (repository, readOptions) => request<GitHubApiRepository>(repository, '', readOptions),
    readCommit: (repository, sha, readOptions) => {
      if (!/^[a-f0-9]{7,40}$/i.test(sha)) throw new GitHubClientError('GitHub commit SHA is invalid');
      return request<GitHubApiCommit>(repository, `commits/${encodeURIComponent(sha)}`, readOptions);
    },
    readPullRequest: (repository, number, readOptions) => request<GitHubApiPullRequest>(repository, itemPath('pulls', number), readOptions),
    readIssue: (repository, number, readOptions) => request<GitHubApiIssue>(repository, itemPath('issues', number), readOptions),
    readIssues: (repository, readOptions) => request<readonly GitHubApiIssue[]>(repository, 'issues', readOptions, true),
    readIssueComments: (repository, number, readOptions) => request<readonly GitHubApiComment[]>(repository, itemPath('issues', number, '/comments'), readOptions, true),
    readReviewComments: (repository, number, readOptions) => request<readonly GitHubApiComment[]>(repository, itemPath('pulls', number, '/comments'), readOptions, true),
    readPullRequestReviews: (repository, number, readOptions) => request<readonly GitHubApiReview[]>(repository, itemPath('pulls', number, '/reviews'), readOptions, true),
  };
}
