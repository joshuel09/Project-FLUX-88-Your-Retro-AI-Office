/**
 * Seed: 18 agents from the typed registry + simulated demo data (FR-053).
 * Idempotent — safe to re-run.
 */
import { AGENT_CONFIGS } from '@flux88/agents';
import { loadConfig } from '@flux88/config';

import { createDbWithClient } from './client.js';
import { agents, budgets, connectorAccounts, tasks } from './schema/index.js';

const { DATABASE_URL } = loadConfig();
const { db, client } = createDbWithClient(DATABASE_URL);

try {
  for (const config of AGENT_CONFIGS) {
    await db
      .insert(agents)
      .values({
        id: config.id,
        displayName: config.displayName,
        department: config.department,
        officeArea: config.officeArea,
        roleSummary: config.roleSummary,
        personality: config.personality,
        config,
      })
      .onConflictDoUpdate({
        target: agents.id,
        set: {
          displayName: config.displayName,
          department: config.department,
          officeArea: config.officeArea,
          roleSummary: config.roleSummary,
          personality: config.personality,
          config,
          updatedAt: new Date(),
        },
      });

    await db
      .insert(budgets)
      .values({ agentId: config.id, ...config.budgets })
      .onConflictDoUpdate({ target: budgets.agentId, set: { ...config.budgets, updatedAt: new Date() } });
  }

  for (const provider of ['github', 'discord', 'trello'] as const) {
    const existing = await db.select().from(connectorAccounts);
    if (!existing.some((c) => c.provider === provider)) {
      await db.insert(connectorAccounts).values({
        provider,
        mode: 'read_only',
        config: { mock: true },
        healthStatus: 'mock',
      });
    }
  }

  const existingDemo = await db.select().from(tasks);
  if (existingDemo.length === 0) {
    await db.insert(tasks).values([
      {
        title: '[DEMO] Research retro UI patterns for the Arcade',
        description: 'Simulated demo task — not real agent execution.',
        creator: 'owner',
        status: 'ready',
        assigneeAgentId: 'eleven',
        simulated: true,
      },
      {
        title: '[DEMO] Draft welcome copy for the Video Store',
        description: 'Simulated demo task — not real agent execution.',
        creator: 'doc',
        status: 'backlog',
        assigneeAgentId: 'robin',
        simulated: true,
      },
    ]);
  }

  console.log('[flux88-db] seeded 18 agents, budgets, mock connectors, demo tasks');
} finally {
  await client.end();
}
