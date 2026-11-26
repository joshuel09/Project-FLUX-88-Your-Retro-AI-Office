import { and, eq, sql } from 'drizzle-orm';
import type { GitHubFeedback } from '@flux88/connectors';
import { schema, type Db } from '@flux88/db';
import type { WorkerDeps, WorkerEvent } from '../deps.js';

const MAX_FEEDBACK_PER_SYNC = 100;
const MAX_FEEDBACK_EXCERPT = 1_000;
const { auditEvents, externalFeedback, externalLinks, tasks } = schema;
const validRepository = (repository: string) => {
  if (repository.length > 140 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return false;
  const [owner, name] = repository.split('/');
  return owner !== '.' && owner !== '..' && name !== '.' && name !== '..';
};

function feedbackExcerpt(body: string): string {
  let excerpt = '';
  let length = 0;
  for (const character of body) {
    if (length++ === MAX_FEEDBACK_EXCERPT) break;
    excerpt += character;
  }
  return excerpt;
}

export interface GitHubSyncResult {
  received: number;
  inserted: number;
  duplicates: number;
  linked: number;
  unmatched: number;
}

/** Stable external-link key; links are created only by an explicit owner action. */
export function githubPullRequestExternalId(repository: string, number: number): string {
  if (!validRepository(repository) || !Number.isSafeInteger(number) || number < 1) {
    throw new Error('Invalid GitHub pull request identity');
  }
  return `${repository.toLowerCase()}#${number}`;
}

function validateFeedback(item: GitHubFeedback, allowedRepositories: ReadonlySet<string>) {
  if (!validRepository(item.repository)) throw new Error('GitHub feedback repository is invalid');
  if (!allowedRepositories.has(item.repository.toLowerCase())) throw new Error('GitHub feedback repository is not allowlisted');
  if (typeof item.externalId !== 'string' || !item.externalId || item.externalId.length > 200 ||
      typeof item.authorLogin !== 'string' || !item.authorLogin || item.authorLogin.length > 100 || typeof item.bodyExcerpt !== 'string') {
    throw new Error('GitHub feedback identity is invalid');
  }
  if (!Number.isSafeInteger(item.number) || item.number < 1 || !['issue_comment', 'pull_request_review', 'pull_request_review_comment'].includes(item.externalType)) {
    throw new Error('GitHub feedback type or issue number is invalid');
  }
  if (Number.isNaN(Date.parse(item.createdAt)) || Number.isNaN(Date.parse(item.updatedAt))) {
    throw new Error('GitHub feedback timestamp is invalid');
  }
  let source: URL;
  try {
    source = new URL(item.sourceUrl);
  } catch {
    throw new Error('GitHub feedback source URL is invalid');
  }
  const path = source.pathname.toLowerCase();
  const repositoryPath = `/${item.repository.toLowerCase()}/`;
  const relativePath = path.startsWith(repositoryPath) ? path.slice(repositoryPath.length) : '';
  if (item.sourceUrl.length > 2_048 || source.origin !== 'https://github.com' || source.search || source.username || source.password ||
      ![`issues/${item.number}`, `pull/${item.number}`].includes(relativePath)) {
    throw new Error('GitHub feedback source URL is not canonical');
  }
}

/** Persist normalized provider data atomically; external text remains inert and untrusted. */
export async function syncGitHubFeedback(
  db: Db,
  items: readonly GitHubFeedback[],
  allowedRepositories: readonly string[],
  publish: WorkerDeps['publish'],
): Promise<GitHubSyncResult> {
  if (items.length > MAX_FEEDBACK_PER_SYNC) throw new Error('GitHub feedback batch exceeds the limit');
  const allowed = new Set(allowedRepositories.map((repository) => repository.toLowerCase()));
  for (const item of items) validateFeedback(item, allowed);

  const { result, events } = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE flux88_worker`);
    await tx.insert(auditEvents).values({
      actorType: 'system', actorId: 'github-sync', action: 'github.feedback_sync_started',
      targetType: 'connector', targetId: 'github', payload: { received: items.length },
    });

    const result: GitHubSyncResult = { received: items.length, inserted: 0, duplicates: 0, linked: 0, unmatched: 0 };
    const events: WorkerEvent[] = [];
    for (const item of items) {
      const [mapping] = await tx.select({
        id: externalLinks.id,
        taskId: tasks.id,
        assigneeAgentId: tasks.assigneeAgentId,
      }).from(externalLinks).innerJoin(tasks, eq(externalLinks.taskId, tasks.id)).where(and(
        eq(externalLinks.provider, 'github'),
        eq(externalLinks.externalType, 'pull_request'),
        eq(externalLinks.externalId, githubPullRequestExternalId(item.repository, item.number)),
      )).limit(1);
      const [stored] = await tx.insert(externalFeedback).values({
        provider: 'github',
        externalId: item.externalId,
        externalType: item.externalType,
        externalLinkId: mapping?.id ?? null,
        taskId: mapping?.taskId ?? null,
        assigneeAgentId: mapping?.assigneeAgentId ?? null,
        authorLogin: item.authorLogin,
        bodyExcerpt: feedbackExcerpt(item.bodyExcerpt),
        sourceUrl: item.sourceUrl,
        state: mapping ? 'linked' : 'pending',
        provenance: 'untrusted',
      }).onConflictDoNothing({ target: [externalFeedback.provider, externalFeedback.externalId] }).returning();
      if (!stored) {
        result.duplicates++;
        continue;
      }
      result.inserted++;
      if (mapping) {
        result.linked++;
        await tx.insert(auditEvents).values({
          actorType: 'system', actorId: 'github-sync', action: 'github.feedback_linked',
          targetType: 'task', targetId: mapping.taskId,
          payload: { feedbackId: stored.id, externalType: item.externalType, assigneeAgentId: mapping.assigneeAgentId },
        });
        events.push({ channel: 'task', data: {
          taskId: mapping.taskId, kind: 'github.feedback', feedbackId: stored.id,
          assigneeAgentId: mapping.assigneeAgentId,
        } });
      } else {
        result.unmatched++;
        await tx.insert(auditEvents).values({
          actorType: 'system', actorId: 'github-sync', action: 'github.feedback_unmatched',
          targetType: 'external_feedback', targetId: stored.id,
          payload: { externalType: item.externalType, repository: item.repository, number: item.number },
        });
        events.push({ channel: 'audit', data: { kind: 'github.feedback.unmatched', feedbackId: stored.id } });
      }
    }
    await tx.insert(auditEvents).values({
      actorType: 'system', actorId: 'github-sync', action: 'github.feedback_sync_completed',
      targetType: 'connector', targetId: 'github',
      payload: { inserted: result.inserted, duplicates: result.duplicates, linked: result.linked, unmatched: result.unmatched },
    });
    return { result, events };
  });

  for (const event of events) await publish(event);
  return result;
}
