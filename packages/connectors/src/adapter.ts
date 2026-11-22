export type ConnectorProvider = 'github' | 'discord' | 'trello';

export interface ConnectorHealth {
  status: 'mock';
  message: string;
  checkedAt: string;
  simulated: true;
}

export interface ConnectorOverview {
  provider: ConnectorProvider;
  label: string;
  itemCount: number;
  simulated: true;
}

/** Read-only contract; write operations are intentionally absent. */
export interface ConnectorAdapter {
  readonly provider: ConnectorProvider;
  readonly mode: 'read_only';
  health(): ConnectorHealth;
  readOverview(): ConnectorOverview;
}

export type GitHubFeedbackType =
  | 'issue_comment'
  | 'pull_request_review'
  | 'pull_request_review_comment';

/** Normalized provider content. The body always remains untrusted input. */
export interface GitHubFeedback {
  readonly externalId: string;
  readonly externalType: GitHubFeedbackType;
  readonly repository: string;
  readonly number: number;
  readonly authorLogin: string;
  readonly bodyExcerpt: string;
  readonly sourceUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: 'untrusted';
}

export interface GitHubSyncRequest {
  readonly repositories: readonly string[];
  readonly limit: number;
  readonly cursor?: string;
  readonly etag?: string;
  readonly since?: string;
}

export interface GitHubRateLimit {
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: string;
  readonly retryAfterSeconds?: number;
}

export interface GitHubFeedbackPage {
  readonly items: readonly GitHubFeedback[];
  readonly nextCursor?: string;
  readonly etag?: string;
  readonly rateLimit: GitHubRateLimit;
}

/** Read-only feedback source; write operations remain in the approval outbox. */
export interface GitHubFeedbackReader {
  readonly provider: 'github';
  readFeedback(request: GitHubSyncRequest): Promise<GitHubFeedbackPage>;
}
