import postgres from 'postgres';

import { loadConfig } from '@flux88/config';

const config = loadConfig();
if (!config.WORKER_DATABASE_URL) {
  throw new Error('Set WORKER_DATABASE_URL before provisioning the worker database role.');
}

const adminUrl = new URL(config.DATABASE_URL);
const workerUrl = new URL(config.WORKER_DATABASE_URL);
if (
  workerUrl.username !== 'flux88_worker_login' ||
  workerUrl.password.length === 0 ||
  workerUrl.hostname !== adminUrl.hostname ||
  workerUrl.port !== adminUrl.port ||
  workerUrl.pathname !== adminUrl.pathname
) {
  throw new Error('WORKER_DATABASE_URL must target the same database as DATABASE_URL and use flux88_worker_login with a password.');
}

const admin = postgres(config.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const [roleStatus] = await admin<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flux88_worker') AS "exists"
  `;
  if (!roleStatus?.exists) throw new Error('Run database migrations before provisioning the worker database role.');

  const [role] = await admin<{ createRole: string }[]>`
    SELECT format('CREATE ROLE %I LOGIN', 'flux88_worker_login') AS "createRole"
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flux88_worker_login')
  `;
  if (role?.createRole) await admin.unsafe(role.createRole);

  const [membershipStatus] = await admin<{ otherRoles: string[] | null }[]>`
    SELECT array_agg(granted_role.rolname) AS "otherRoles"
    FROM pg_auth_members AS membership
    JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
    JOIN pg_roles AS member_role ON member_role.oid = membership.member
    WHERE member_role.rolname = 'flux88_worker_login'
      AND granted_role.rolname <> 'flux88_worker'
  `;
  if (membershipStatus?.otherRoles?.length) {
    throw new Error('flux88_worker_login must not inherit any role except flux88_worker.');
  }

  const password = decodeURIComponent(workerUrl.password);
  const [passwordCommand] = await admin<{ setPassword: string }[]>`
    SELECT format(
      'ALTER ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
      'flux88_worker_login',
      ${password}::text
    ) AS "setPassword"
  `;
  if (!passwordCommand?.setPassword) throw new Error('Could not prepare the worker role password command.');
  await admin.unsafe(passwordCommand.setPassword);
  await admin.unsafe('GRANT flux88_worker TO flux88_worker_login');
} finally {
  await admin.end();
}
