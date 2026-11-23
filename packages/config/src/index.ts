/**
 * @flux88/config — typed environment configuration.
 * The ONLY module allowed to read process.env (plan.md security boundary 6).
 * Secrets never leave this module as loggable objects.
 */
import { z } from 'zod';

const optionalCostRate = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.coerce.number().finite().nonnegative().optional(),
);

const optionalText = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).optional(),
);

const commaSeparated = <T extends z.ZodTypeAny>(item: T) => z.preprocess(
  (value) => typeof value === 'string'
    ? value.split(',').map((part) => part.trim()).filter(Boolean)
    : value,
  z.array(item).default([]),
);

const discordSnowflake = z.string().regex(/^\d{17,20}$/);

const envSchema = z.object({
  DATABASE_URL: z.string().url().default('postgres://flux88:flux88_local_dev@localhost:5488/flux88'),
  WORKER_DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().default('redis://localhost:6388'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(16).default('change-me-generate-a-real-random-value'),
  MOCK_LLM: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  ANTHROPIC_MODEL: z.string().trim().min(1).optional(),
  ANTHROPIC_INPUT_COST_CENTS_PER_MILLION: optionalCostRate,
  ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION: optionalCostRate,
  GITHUB_CONNECTOR: z.enum(['mock', 'live']).default('mock'),
  GITHUB_TOKEN: optionalText,
  GITHUB_REPOSITORIES: commaSeparated(z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)),
  DISCORD_CONNECTOR: z.enum(['mock', 'live']).default('mock'),
  DISCORD_BOT_TOKEN: optionalText,
  DISCORD_OWNER_USER_ID: z.preprocess((value) => value === '' ? undefined : value, discordSnowflake.optional()),
  DISCORD_GUILD_ID: z.preprocess((value) => value === '' ? undefined : value, discordSnowflake.optional()),
  DISCORD_CHANNEL_ID: z.preprocess((value) => value === '' ? undefined : value, discordSnowflake.optional()),
  DISCORD_NOTIFICATION_TEMPLATES: commaSeparated(z.enum(['task_update', 'review_reminder'])),
  TRELLO_CONNECTOR: z.enum(['mock', 'live']).default('mock'),
  QUIET_HOURS: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/).default('22:00-07:00'),
  MAX_PARALLEL_AGENT_RUNS: z.coerce.number().int().positive().max(18).default(3),
}).superRefine((config, ctx) => {
  if (!config.MOCK_LLM) {
    const requiredLiveFields = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_INPUT_COST_CENTS_PER_MILLION',
      'ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION',
    ] as const;
    for (const field of requiredLiveFields) {
      if (config[field] === undefined || config[field] === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'is required when MOCK_LLM=false' });
      }
    }
  }

  if (config.GITHUB_CONNECTOR === 'live') {
    if (!config.GITHUB_TOKEN) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['GITHUB_TOKEN'], message: 'is required for live GitHub mode' });
    }
    if (config.GITHUB_REPOSITORIES.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['GITHUB_REPOSITORIES'], message: 'must list at least one repository for live GitHub mode' });
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['GITHUB_CONNECTOR'], message: 'live GitHub mode is unavailable until its adapter is implemented' });
  }

  if (config.DISCORD_CONNECTOR === 'live') {
    const requiredDiscordFields = [
      'DISCORD_BOT_TOKEN',
      'DISCORD_OWNER_USER_ID',
      'DISCORD_GUILD_ID',
      'DISCORD_CHANNEL_ID',
    ] as const;
    for (const field of requiredDiscordFields) {
      if (!config[field]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'is required for live Discord mode' });
      }
    }
    if (config.DISCORD_NOTIFICATION_TEMPLATES.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DISCORD_NOTIFICATION_TEMPLATES'], message: 'must enable at least one template for live Discord mode' });
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DISCORD_CONNECTOR'], message: 'live Discord mode is unavailable until its adapter is implemented' });
  }
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
