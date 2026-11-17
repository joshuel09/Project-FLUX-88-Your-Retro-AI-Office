import { sql } from 'drizzle-orm';

import type { Db } from '@flux88/db';

export async function assertWorkerDatabaseRole(db: Db): Promise<void> {
  const [identity] = await db.execute(sql`
    SELECT role.rolsuper AS is_superuser,
      pg_has_role(session_user, 'flux88_worker', 'MEMBER') AS has_worker_role,
      NOT EXISTS (
        SELECT 1
        FROM pg_auth_members AS membership
        JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
        WHERE membership.member = role.oid
          AND granted_role.rolname <> 'flux88_worker'
      ) AS has_no_other_roles
    FROM pg_roles AS role
    WHERE role.rolname = session_user
  `);

  const row = identity as unknown as {
    is_superuser: boolean;
    has_worker_role: boolean;
    has_no_other_roles: boolean;
  } | undefined;
  if (!row || row.is_superuser || !row.has_worker_role || !row.has_no_other_roles) {
    throw new Error('Worker database credentials must be a non-superuser member of flux88_worker.');
  }
}
