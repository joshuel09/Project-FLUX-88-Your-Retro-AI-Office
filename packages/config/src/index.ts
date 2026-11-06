/**
 * @flux88/config — typed environment configuration.
 * The ONLY module allowed to read process.env (plan.md security boundary 6).
 * Secrets never leave this module as loggable objects.
 */
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().default('postgres://flux88:flux88_local_dev@localhost:5488/flux88'),
  REDIS_URL: z.string().url().default('redis://localhost:6388'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(16).default('change-me-generate-a-real-random-value'),
  MOCK_LLM: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  ANTHROPIC_API_KEY: z.string().optional(),
  GITHUB_CONNECTOR: z.enum(['mock', 'live']).default('mock'),
  DISCORD_CONNECTOR: z.enum(['mock', 'live']).default('mock'),
  TRELLO_CONNECTOR: z.enum(['mock', 'live']).default('mock'),
  QUIET_HOURS: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/).default('22:00-07:00'),
  MAX_PARALLEL_AGENT_RUNS: z.coerce.number().int().positive().max(18).default(3),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Never echo raw env values in errors (could contain secrets).
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration for: ${fields}`);
  }
  return parsed.data;
}
