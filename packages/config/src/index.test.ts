import { describe, expect, it } from 'vitest';

import { loadConfig } from './index.js';

describe('LLM provider configuration', () => {
  it('keeps mock mode as the no-credential default', () => {
    expect(loadConfig({}).MOCK_LLM).toBe(true);
  });

  it('requires a key, model, and explicit token rates for live mode without echoing values', () => {
    expect(() => loadConfig({ MOCK_LLM: 'false' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ MOCK_LLM: 'false', ANTHROPIC_API_KEY: '   ' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig({
      MOCK_LLM: 'false',
      ANTHROPIC_API_KEY: 'test-only-key',
      ANTHROPIC_MODEL: 'claude-test',
    })).toThrow(/ANTHROPIC_INPUT_COST_CENTS_PER_MILLION/);
    expect(() => loadConfig({
      MOCK_LLM: 'false',
      ANTHROPIC_API_KEY: 'test-only-key',
      ANTHROPIC_MODEL: 'claude-test',
      ANTHROPIC_INPUT_COST_CENTS_PER_MILLION: '-1',
      ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION: '1500',
    })).toThrow(/ANTHROPIC_INPUT_COST_CENTS_PER_MILLION/);
    expect(() => loadConfig({
      MOCK_LLM: 'false',
      ANTHROPIC_API_KEY: 'test-only-key',
      ANTHROPIC_MODEL: 'claude-test',
      ANTHROPIC_INPUT_COST_CENTS_PER_MILLION: '',
      ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION: '1500',
    })).toThrow(/ANTHROPIC_INPUT_COST_CENTS_PER_MILLION/);
  });

  it('parses live model and cost rates', () => {
    const config = loadConfig({
      MOCK_LLM: 'false',
      ANTHROPIC_API_KEY: 'test-only-key',
      ANTHROPIC_MODEL: 'claude-test',
      ANTHROPIC_INPUT_COST_CENTS_PER_MILLION: '300',
      ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION: '1500',
    });

    expect(config).toMatchObject({
      MOCK_LLM: false,
      ANTHROPIC_MODEL: 'claude-test',
      ANTHROPIC_INPUT_COST_CENTS_PER_MILLION: 300,
      ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION: 1500,
    });
  });
});

describe('GitHub and Discord configuration', () => {
  it('keeps mock connectors enabled with empty allowlists and no credentials by default', () => {
    expect(loadConfig({})).toMatchObject({
      GITHUB_CONNECTOR: 'mock',
      DISCORD_CONNECTOR: 'mock',
      GITHUB_REPOSITORIES: [],
      DISCORD_NOTIFICATION_TEMPLATES: [],
    });
  });

  it('parses repository, destination, and notification allowlists', () => {
    expect(loadConfig({
      GITHUB_TOKEN: 'test-github-token',
      GITHUB_REPOSITORIES: 'owner/repo, second/project',
      DISCORD_BOT_TOKEN: 'test-discord-token',
      DISCORD_OWNER_USER_ID: '12345678901234567',
      DISCORD_GUILD_ID: '22345678901234567',
      DISCORD_CHANNEL_ID: '32345678901234567',
      DISCORD_NOTIFICATION_TEMPLATES: 'task_update, review_reminder',
    })).toMatchObject({
      GITHUB_REPOSITORIES: ['owner/repo', 'second/project'],
      DISCORD_OWNER_USER_ID: '12345678901234567',
      DISCORD_GUILD_ID: '22345678901234567',
      DISCORD_CHANNEL_ID: '32345678901234567',
      DISCORD_NOTIFICATION_TEMPLATES: ['task_update', 'review_reminder'],
    });
  });

  it('reports invalid connector fields without echoing credentials', () => {
    const githubSecret = 'github-secret-must-not-appear';
    const discordSecret = 'discord-secret-must-not-appear';

    let githubError = '';
    try {
      loadConfig({ GITHUB_CONNECTOR: 'live', GITHUB_TOKEN: githubSecret, GITHUB_REPOSITORIES: 'not-a-repository' });
    } catch (error) {
      githubError = error instanceof Error ? error.message : String(error);
    }
    let discordError = '';
    try {
      loadConfig({
        DISCORD_CONNECTOR: 'live',
        DISCORD_BOT_TOKEN: discordSecret,
        DISCORD_OWNER_USER_ID: 'owner',
        DISCORD_GUILD_ID: 'guild',
        DISCORD_CHANNEL_ID: 'channel',
        DISCORD_NOTIFICATION_TEMPLATES: 'free_form',
      });
    } catch (error) {
      discordError = error instanceof Error ? error.message : String(error);
    }

    expect(githubError).toContain('GITHUB_REPOSITORIES');
    expect(githubError).not.toContain(githubSecret);
    expect(discordError).toContain('DISCORD_OWNER_USER_ID');
    expect(discordError).toContain('DISCORD_NOTIFICATION_TEMPLATES');
    expect(discordError).not.toContain(discordSecret);
  });

  it('rejects live provider selection until its adapter is implemented', () => {
    expect(() => loadConfig({
      GITHUB_CONNECTOR: 'live',
      GITHUB_TOKEN: 'test-github-token',
      GITHUB_REPOSITORIES: 'owner/repo',
    })).toThrow(/GITHUB_CONNECTOR/);
    expect(() => loadConfig({
      DISCORD_CONNECTOR: 'live',
      DISCORD_BOT_TOKEN: 'test-discord-token',
      DISCORD_OWNER_USER_ID: '12345678901234567',
      DISCORD_GUILD_ID: '22345678901234567',
      DISCORD_CHANNEL_ID: '32345678901234567',
      DISCORD_NOTIFICATION_TEMPLATES: 'task_update',
    })).toThrow(/DISCORD_CONNECTOR/);
  });
});
