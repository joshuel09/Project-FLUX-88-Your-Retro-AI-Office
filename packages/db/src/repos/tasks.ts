import { desc, eq } from 'drizzle-orm';

import { canTransition, type TaskStatus } from '@flux88/core';
import type { Db } from '../client.js';
import { tasks } from '../schema/index.js';

export async function listTasks(db: Db, opts: { status?: TaskStatus; limit?: number } = {}) {
  return db
    .select()
    .from(tasks)
    .where(opts.status ? eq(tasks.status, opts.status) : undefined)
    .orderBy(desc(tasks.createdAt))
    .limit(opts.limit ?? 200);
}

export async function getTask(db: Db, id: string) {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  return row ?? null;
}

export async function createTask(
  db: Db,
  values: {
    title: string;
    description?: string;
    creator: string;
    priority?: number;
    simulated?: boolean;
  },
) {
  const [row] = await db.insert(tasks).values(values).returning();
  return row;
}

/** Guarded transition — throws on an illegal move (FR-011). */
export async function transitionTask(db: Db, id: string, to: TaskStatus) {
  const current = await getTask(db, id);
  if (!current) throw new Error('task not found');
  if (!canTransition(current.status, to)) {
    throw new Error(`illegal transition ${current.status} -> ${to}`);
  }
  const [row] = await db
    .update(tasks)
    .set({ status: to, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return row;
}
