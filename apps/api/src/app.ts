import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';

import { loadConfig, type AppConfig } from '@flux88/config';
import { AGENT_IDS } from '@flux88/core';
import { createDb, type Db } from '@flux88/db';

import { authRoutes } from './auth/routes.js';
import { noopEnqueuer, type TaskEnqueuer } from './enqueue.js';
import { auditMutations } from './middleware/audit.js';
import { requireOwner } from './middleware/auth.js';
import { strictOrigin } from './middleware/origin.js';
import { agentsRoutes } from './routes/agents.js';
import { eventsRoutes } from './routes/events.js';
import { tasksRoutes } from './routes/tasks.js';

export interface AppDeps {
  config?: AppConfig;
  db?: Db;
  /** BullMQ-backed in production (index.ts); defaults to a no-op for tests. */
  enqueue?: TaskEnqueuer;
}

/** Build the Hono app — exported for tests (supertest-style via app.request). */
export function createApp(deps: AppDeps = {}) {
  const config = deps.config ?? loadConfig();
  const db = deps.db ?? createDb(config.DATABASE_URL);
  const enqueue = deps.enqueue ?? noopEnqueuer;

  const app = new Hono();

  const allowedOrigins = [new URL(config.WEB_URL).origin, `http://localhost:${config.API_PORT}`];
  app.use(secureHeaders());
  // CSRF (constitution Security Requirements): hono/csrf covers form posts,
  // strictOrigin extends the Origin check to every mutating request.
  app.use(csrf({ origin: allowedOrigins }));
  app.use(strictOrigin(allowedOrigins));
  app.use(auditMutations(db));

  app.get('/health', (c) =>
    c.json({ ok: true, service: 'flux88-api', mockLlm: config.MOCK_LLM, agents: AGENT_IDS.length }),
  );

  app.route('/api/v1/auth', authRoutes(db));

  const protectedApi = new Hono();
  protectedApi.use(requireOwner(db));
  protectedApi.route('/agents', agentsRoutes(db));
  protectedApi.route('/tasks', tasksRoutes(db, enqueue));
  protectedApi.route('/events', eventsRoutes());
  app.route('/api/v1', protectedApi);

  app.get('/api/v1', (c) =>
    c.json({ name: 'FLUX-88 API', phase: '1-foundational', docs: 'specs/001-flux-88-platform/contracts/api.md' }),
  );

  return { app, db, config };
}
