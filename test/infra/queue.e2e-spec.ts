import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue, Worker, type Job } from 'bullmq';
import { DEFAULT_JOB_OPTIONS, jobId } from '../../src/infra/queue/job-defaults.js';
import { createRedisClient } from '../../src/infra/queue/redis.connection.js';
import { QUEUES } from '../../src/infra/queue/queue.module.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Contra o Redis do docker compose (ou o serviço do CI). Cada teste usa uma fila com nome único. */
describe('Fila de jobs (e2e)', () => {
  let t: TestApp;
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  /** Em ESM nativo o BullMQ 6 exige um cliente já construído. */
  const connection = () => {
    const client = createRedisClient(redisUrl);
    clients.push(client);
    return client;
  };
  const closers: Array<() => Promise<unknown>> = [];
  /** Fechados por último, depois dos workers e das filas que os usam. */
  const clients: Array<{ quit(): Promise<unknown> }> = [];

  function uniqueQueue(overrides: Partial<typeof DEFAULT_JOB_OPTIONS> = {}): Queue {
    const queue = new Queue(`test-${randomUUID()}`, {
      connection: connection(),
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, ...overrides },
    });
    closers.push(() => queue.obliterate({ force: true }).then(() => queue.close()));
    return queue;
  }

  function worker(queue: Queue, processor: (job: Job) => Promise<unknown>): Worker {
    const w = new Worker(queue.name, processor, { connection: connection() });
    closers.unshift(() => w.close());
    return w;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    for (const close of closers) await close();
    for (const client of clients) await client.quit();
    await t.close();
  });

  it('as filas notifications e maintenance estão registradas com os padrões seguros', () => {
    for (const name of [QUEUES.notifications, QUEUES.maintenance]) {
      const queue = t.app.get<Queue>(getQueueToken(name));
      expect(queue.name).toBe(name);
      expect(queue.defaultJobOptions).toMatchObject(DEFAULT_JOB_OPTIONS);
    }
  });

  it('o mesmo jobId roda uma única vez', async () => {
    const queue = uniqueQueue();
    const processed: string[] = [];
    const id = jobId('notify-new-report', randomUUID());
    await queue.add('notify', { n: 1 }, { jobId: id });
    await queue.add('notify', { n: 2 }, { jobId: id });
    worker(queue, async (job) => processed.push(String(job.id)));
    await sleep(800);
    expect(processed).toEqual([id]);
  });

  it('job que falha é tentado de novo até o limite de tentativas', async () => {
    const queue = uniqueQueue({ attempts: 3, backoff: { type: 'exponential', delay: 20 } });
    let calls = 0;
    worker(queue, async () => {
      calls += 1;
      throw new Error('falha simulada');
    });
    await queue.add('instavel', {});
    await sleep(1500);
    expect(calls).toBe(3);
    expect(await queue.getFailedCount()).toBe(1);
  });

  it('job scheduler com dois workers gera uma única execução por disparo', async () => {
    const queue = uniqueQueue();
    const runs: string[] = [];
    const processor = async (job: Job) => runs.push(String(job.id));
    worker(queue, processor);
    worker(queue, processor);
    await queue.upsertJobScheduler('tick', { every: 250 }, { name: 'tick', data: {} });
    await sleep(1400);
    await queue.removeJobScheduler('tick');
    expect(runs.length).toBeGreaterThanOrEqual(3);
    expect(new Set(runs).size).toBe(runs.length);
  });

  it('o histórico de concluídos respeita o limite', async () => {
    const queue = uniqueQueue({ removeOnComplete: { count: 2 } });
    worker(queue, async () => 'ok');
    for (let i = 0; i < 6; i++) await queue.add('rapido', { i });
    await sleep(1000);
    expect(await queue.getCompletedCount()).toBeLessThanOrEqual(2);
  });
});
