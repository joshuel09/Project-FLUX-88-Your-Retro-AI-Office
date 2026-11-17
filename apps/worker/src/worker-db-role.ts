import { sql } from 'drizzle-orm';

import type { Db } from '@flux88/db';

export async function assertWorkerDatabaseRole(db: Db): Promise<void> {
  const [identity] = await db.execute(sql`
    SELECT role.rolsuper AS is_superuser,
      role.rolcreatedb AS can_create_database,
      role.rolcreaterole AS can_create_roles,
      role.rolreplication AS can_replicate,
      role.rolbypassrls AS can_bypass_rls,
      role.rolinherit AS can_inherit,
      pg_has_role(session_user, 'flux88_worker', 'MEMBER') AS has_worker_role,
      NOT (
        has_table_privilege(session_user, 'agents', 'INSERT') OR
        has_table_privilege(session_user, 'agents', 'UPDATE') OR
        has_table_privilege(session_user, 'agents', 'DELETE') OR
        has_table_privilege(session_user, 'owner', 'INSERT') OR
        has_table_privilege(session_user, 'owner', 'UPDATE') OR
        has_table_privilege(session_user, 'owner', 'DELETE') OR
        has_table_privilege(session_user, 'sessions', 'INSERT') OR
        has_table_privilege(session_user, 'sessions', 'UPDATE') OR
        has_table_privilege(session_user, 'sessions', 'DELETE') OR
        has_table_privilege(session_user, 'approval_requests', 'INSERT') OR
        has_table_privilege(session_user, 'approval_requests', 'UPDATE') OR
        has_table_privilege(session_user, 'approval_requests', 'DELETE') OR
        has_table_privilege(session_user, 'approval_grants', 'INSERT') OR
        has_table_privilege(session_user, 'approval_grants', 'UPDATE') OR
        has_table_privilege(session_user, 'approval_grants', 'DELETE')
      ) AS has_no_protected_write_access,
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
    can_create_database: boolean;
    can_create_roles: boolean;
    can_replicate: boolean;
    can_bypass_rls: boolean;
    can_inherit: boolean;
    has_worker_role: boolean;
    has_no_protected_write_access: boolean;
    has_no_other_roles: boolean;
  } | undefined;
  if (
    !row || row.is_superuser || row.can_create_database || row.can_create_roles || row.can_replicate ||
    row.can_bypass_rls || !row.can_inherit || !row.has_worker_role || !row.has_no_protected_write_access ||
    !row.has_no_other_roles
  ) {
    throw new Error('Worker database credentials must be a non-superuser member of flux88_worker.');
  }
}
