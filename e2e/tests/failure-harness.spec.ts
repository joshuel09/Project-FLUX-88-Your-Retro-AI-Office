import { expect, test } from '@playwright/test';
import { MockProvider } from '../../packages/llm/src/mock.js';
import { createFailureHarness, FAILURE_CHECKPOINTS, FailureInjectingProvider } from '../failure/harness.js';

test('failure harness scopes provider, worker, and Redis interruption to its own resources', async () => {
  test.setTimeout(120_000);
  const harness = await createFailureHarness();
  try {
    expect(await harness.pingRedis()).toBe('PONG');

    const provider = new FailureInjectingProvider(new MockProvider());
    provider.failNextCompletion();
    const request = { agentId: 'doc', prompt: 'Write a test draft', maxTokens: 100 };
    await expect(provider.complete(request)).rejects.toThrow('injected_provider_failure');
    await expect(provider.complete(request)).resolves.toMatchObject({ content: expect.any(String) });

    const worker = harness.spawnWorker(process.execPath, ['-e', `process.stdout.write("${FAILURE_CHECKPOINTS.worker}\\n"); setInterval(() => {}, 1000)`]);
    await worker.waitForOutput(FAILURE_CHECKPOINTS.worker);
    await harness.killWorker(worker);
    expect(worker.process.signalCode).toBe('SIGKILL');

    await harness.killRedis();
    await expect(harness.pingRedis()).rejects.toThrow();
    await harness.restartRedis();
    expect(await harness.pingRedis()).toBe('PONG');
  } finally {
    await harness.close();
  }
  expect(await harness.remainingContainers()).toEqual([]);
});
