import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { schema, type Db } from '@flux88/db';

export interface ReminderScheduleOptions {
  enabled: boolean;
  intervalHours: number;
  quietHours: string;
  now: Date;
}

export interface ReminderScheduleResult {
  scheduled: number;
  deferred: number;
  released: number;
}

export const REMINDER_POLL_INTERVAL_MS = 60_000;
export const MAX_REMINDER_SCHEDULER_ATTEMPTS = 3;

function parseQuietHours(value: string): { start: number; end: number } {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Invalid reminder quiet hours');
  const [startHour, startMinute, endHour, endMinute] = match.slice(1).map(Number);
  if (startHour! > 23 || endHour! > 23 || startMinute! > 59 || endMinute! > 59) {
    throw new Error('Invalid reminder quiet hours');
  }
  return { start: startHour! * 60 + startMinute!, end: endHour! * 60 + endMinute! };
}

function isQuietTime(date: Date, window: { start: number; end: number }) {
  const minute = date.getHours() * 60 + date.getMinutes();
  if (window.start === window.end) return false;
  return window.start < window.end
    ? minute >= window.start && minute < window.end
    : minute >= window.start || minute < window.end;
}

function reminderBody(taskId: string, assigneeAgentId: string | null, sourceUrl: string) {
  return `GitHub review feedback is waiting on task ${taskId}. Current assignee: ${assigneeAgentId ?? 'unassigned'}. Review: ${sourceUrl}`;
}

export async function scheduleLinkedFeedbackReminders(
  db: Db,
  options: ReminderScheduleOptions,
): Promise<ReminderScheduleResult> {
  if (!options.enabled) return { scheduled: 0, deferred: 0, released: 0 };
  if (!Number.isInteger(options.intervalHours) || options.intervalHours < 1 || options.intervalHours > 168 ||
      !Number.isFinite(options.now.getTime())) {
    throw new Error('Invalid reminder schedule options');
  }

  const intervalMs = options.intervalHours * 60 * 60 * 1_000;
  const quietWindow = parseQuietHours(options.quietHours);
  const nowInQuietHours = isQuietTime(options.now, quietWindow);

  return db.transaction(async (tx) => {
    let scheduled = 0;
    let deferred = 0;
    let released = 0;
    const feedbackItems = await tx.select({
      feedbackId: schema.externalFeedback.id,
      receivedAt: schema.externalFeedback.receivedAt,
      sourceUrl: schema.externalFeedback.sourceUrl,
      taskId: schema.tasks.id,
      assigneeAgentId: schema.tasks.assigneeAgentId,
    }).from(schema.externalFeedback).innerJoin(schema.tasks, eq(schema.externalFeedback.taskId, schema.tasks.id))
      .where(and(eq(schema.externalFeedback.state, 'linked'), isNotNull(schema.externalFeedback.taskId)));

    for (const item of feedbackItems) {
      const elapsedMs = options.now.getTime() - item.receivedAt.getTime();
      if (elapsedMs < intervalMs) continue;

      const intervalNumber = Math.floor(elapsedMs / intervalMs);
      const deliveryInterval = new Date(item.receivedAt.getTime() + intervalNumber * intervalMs);
      const dedupeKey = `github-feedback:${item.feedbackId}:review-reminder`;
      const [pending] = await tx.select().from(schema.notifications).where(and(
        eq(schema.notifications.dedupeKey, dedupeKey),
        inArray(schema.notifications.deliveryStatus, ['pending', 'attempting']),
      )).limit(1);

      if (pending) {
        if (pending.deliveryStatus === 'pending' && !pending.approvalRequestId) {
          const body = reminderBody(item.taskId, item.assigneeAgentId, item.sourceUrl);
          const changes = pending.quietHoursDeferred !== nowInQuietHours || pending.body !== body;
          if (changes) {
            const [updated] = await tx.update(schema.notifications).set({
              body,
              quietHoursDeferred: nowInQuietHours,
            }).where(and(
              eq(schema.notifications.id, pending.id),
              eq(schema.notifications.deliveryStatus, 'pending'),
              isNull(schema.notifications.approvalRequestId),
              isNull(schema.notifications.approvalBatchId),
            )).returning();
            if (updated && nowInQuietHours) deferred += 1;
            if (updated && pending.quietHoursDeferred && !nowInQuietHours) released += 1;
          } else if (nowInQuietHours) {
            deferred += 1;
          }
        } else if (pending.quietHoursDeferred && nowInQuietHours) {
          deferred += 1;
        }
        continue;
      }

      const quietHoursDeferred = nowInQuietHours || isQuietTime(deliveryInterval, quietWindow);
      const inserted = await tx.insert(schema.notifications).values({
        channel: 'dashboard',
        taskId: item.taskId,
        body: reminderBody(item.taskId, item.assigneeAgentId, item.sourceUrl),
        dedupeKey,
        deliveryInterval,
        deliveryStatus: 'pending',
        quietHoursDeferred,
      }).onConflictDoNothing().returning({ id: schema.notifications.id });
      if (inserted.length) {
        scheduled += 1;
        if (quietHoursDeferred) deferred += 1;
      }
    }

    return { scheduled, deferred, released };
  });
}

export async function runWithBoundedReminderRetries<T>(
  operation: () => Promise<T>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_REMINDER_SCHEDULER_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === MAX_REMINDER_SCHEDULER_ATTEMPTS) throw error;
      await wait(1_000 * 2 ** (attempt - 1));
    }
  }
  throw new Error('unreachable');
}

export function startFeedbackReminderScheduler(
  db: Db,
  options: Omit<ReminderScheduleOptions, 'now'>,
  onError: () => void,
  pollIntervalMs = REMINDER_POLL_INTERVAL_MS,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void>;
  const tick = async () => {
    try {
      await runWithBoundedReminderRetries(() => scheduleLinkedFeedbackReminders(db, { ...options, now: new Date() }));
    } catch {
      onError();
    } finally {
      if (!stopped) timer = setTimeout(() => { active = tick(); }, pollIntervalMs);
    }
  };
  active = tick();
  return {
    async close() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await active;
    },
  };
}
