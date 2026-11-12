import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { CompletionRequest, CompletionResult, LLMProvider } from '../../packages/llm/src/provider.js';

export const FAILURE_CHECKPOINTS = Object.freeze({
  provider: 'runner.running.before-provider-response',
  worker: 'agent-run.running.before-artifact-commit',
  redis: 'worker.state-committed.before-event-publish',
} as const);

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const composeFile = fileURLToPath(new URL('./compose.yml', import.meta.url));

type CommandResult = { stdout: string; stderr: string };
function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} ${args.join(' ')} failed: ${stderr || error.message}`));
      else resolve({ stdout, stderr });
    });
  });
}

export interface OwnedWorker {
  readonly process: ChildProcess;
  readonly exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output(): string;
  waitForOutput(marker: string, timeoutMs?: number): Promise<void>;
}

export class FailureInjectingProvider implements LLMProvider {
  readonly name: LLMProvider['name'];
  private armed = false;

  constructor(private readonly delegate: LLMProvider) {
    this.name = delegate.name;
  }

  failNextCompletion() { this.armed = true; }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    if (this.armed) {
      this.armed = false;
      throw new Error('injected_provider_failure');
    }
    return this.delegate.complete(request);
  }
}

/** Owns one uniquely named Compose project and any worker child it starts. */
export class FailureInjectionHarness {
  readonly projectName = `flux88-failure-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  databaseUrl: string;
  redisUrl: string;
  private readonly composeEnv: NodeJS.ProcessEnv;
  private readonly workers = new Set<OwnedWorker>();
  private closed = false;

  private constructor(password: string) {
    this.composeEnv = { ...process.env, FAILURE_TEST_PG_PASSWORD: password };
    this.databaseUrl = `postgres://flux88:${password}@127.0.0.1:1/flux88_failure`;
    this.redisUrl = 'redis://127.0.0.1:1';
  }

  static async create(): Promise<FailureInjectionHarness> {
    const harness = new FailureInjectionHarness(randomBytes(24).toString('hex'));
    try {
      await harness.compose(['up', '--detach', '--wait', '--wait-timeout', '90']);
      const pgPort = await harness.publishedPort('postgres', 5432);
      const redisPort = await harness.publishedPort('redis', 6379);
      Object.assign(harness, {
        databaseUrl: `postgres://flux88:${harness.composeEnv.FAILURE_TEST_PG_PASSWORD}@127.0.0.1:${pgPort}/flux88_failure`,
        redisUrl: `redis://127.0.0.1:${redisPort}`,
      });
      return harness;
    } catch (error) {
      await harness.close().catch(() => {});
      throw error;
    }
  }

  private async compose(args: string[]) {
    if (this.closed) throw new Error('failure harness is closed');
    return run('docker', ['compose', '--project-name', this.projectName, '--file', composeFile, ...args], repositoryRoot, this.composeEnv);
  }

  private async publishedPort(service: string, containerPort: number): Promise<number> {
    const { stdout } = await this.compose(['port', service, String(containerPort)]);
    const port = Number(stdout.trim().slice(stdout.trim().lastIndexOf(':') + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`could not resolve ${service} port`);
    return port;
  }

  async pingRedis() {
    return (await this.compose(['exec', '--no-TTY', 'redis', 'redis-cli', 'ping'])).stdout.trim();
  }

  async killRedis() { await this.compose(['kill', 'redis']); }

  async restartRedis() {
    await this.compose(['start', 'redis']);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        if (await this.pingRedis() === 'PONG') return;
      } catch { /* Wait for only this test-owned service to become ready. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('isolated Redis did not recover');
  }

  spawnWorker(command = process.execPath, args = ['--import', 'tsx', path.join(repositoryRoot, 'apps/worker/src/index.ts')], extraEnv: NodeJS.ProcessEnv = {}): OwnedWorker {
    if (this.closed) throw new Error('failure harness is closed');
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: { ...process.env, ...extraEnv, DATABASE_URL: this.databaseUrl, REDIS_URL: this.redisUrl, MOCK_LLM: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let captured = '';
    const waiters = new Set<{ marker: string; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const append = (chunk: Buffer) => {
      captured += chunk.toString();
      for (const waiter of [...waiters]) {
        if (captured.includes(waiter.marker)) {
          clearTimeout(waiter.timer);
          waiters.delete(waiter);
          waiter.resolve();
        }
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const owned: OwnedWorker = {
      process: child,
      exit: new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
      output: () => captured,
      waitForOutput(marker, timeoutMs = 10_000) {
        if (captured.includes(marker)) return Promise.resolve();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`worker did not emit ${marker}; output: ${captured}`));
          }, timeoutMs);
          const waiter = { marker, resolve, reject, timer };
          waiters.add(waiter);
        });
      },
    };
    this.workers.add(owned);
    return owned;
  }

  async killWorker(worker: OwnedWorker, signal: NodeJS.Signals = 'SIGKILL') {
    if (!this.workers.has(worker)) throw new Error('worker is not owned by this failure harness');
    if (worker.process.exitCode === null && worker.process.signalCode === null) {
      worker.process.kill(signal);
      await worker.exit;
    }
  }

  async remainingContainers(): Promise<string[]> {
    const { stdout } = await run('docker', ['ps', '--all', '--quiet', '--filter', `label=com.docker.compose.project=${this.projectName}`], repositoryRoot, this.composeEnv);
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  async close() {
    if (this.closed) return;
    for (const worker of this.workers) {
      if (worker.process.exitCode === null && worker.process.signalCode === null) await this.killWorker(worker);
    }
    await this.compose(['down', '--volumes', '--remove-orphans']).catch((error) => {
      if (!this.closed) throw error;
    });
    this.closed = true;
  }
}

export async function createFailureHarness() { return FailureInjectionHarness.create(); }
