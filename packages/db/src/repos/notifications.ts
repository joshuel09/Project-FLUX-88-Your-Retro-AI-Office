import { desc } from 'drizzle-orm';

import type { Db } from '../client.js';
import { notifications } from '../schema/index.js';

export async function listNotifications(db: Db, limit = 50) {
  return db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit);
}
