import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { RedisThrottlerStorage } from '../../src/infra/throttle/redis-throttler.storage.js';
import { applyTestEnv } from '../support/test-env.js';

/** US5 (T036, R4): storage do limite de tentativas sobre o Redis. */
describe('RedisThrottlerStorage (e2e)', () => {
  let redis: Redis;
  let storage: RedisThrottlerStorage;
  const prefix = `t-${randomUUID()}`;

  beforeAll(() => {
    applyTestEnv();
    redis = new Redis(process.env.REDIS_URL!);
    storage = new RedisThrottlerStorage(redis, prefix);
  });

  afterAll(async () => {
    const keys = await redis.keys(`throttle:${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('conta, bloqueia acima do limite e informa o tempo restante em segundos', async () => {
    const key = randomUUID();
    const records = [];
    for (let i = 0; i < 4; i++) records.push(await storage.increment(key, 60_000, 3, 60_000, 'ip'));
    expect(records.map((r) => r.totalHits)).toEqual([1, 2, 3, 4]);
    expect(records.map((r) => r.isBlocked)).toEqual([false, false, false, true]);
    expect(records[3].timeToExpire).toBeGreaterThan(0);
    expect(records[3].timeToExpire).toBeLessThanOrEqual(60);
    expect(records[3].timeToBlockExpire).toBe(records[3].timeToExpire);
  });

  it('a janela expira e o contador recomeça', async () => {
    const key = randomUUID();
    await storage.increment(key, 300, 1, 300, 'ip');
    expect((await storage.increment(key, 300, 1, 300, 'ip')).isBlocked).toBe(true);
    await new Promise((r) => setTimeout(r, 450));
    expect((await storage.increment(key, 300, 1, 300, 'ip')).totalHits).toBe(1);
  });

  it('50 incrementos simultâneos: contagem exata, sem perder nenhum', async () => {
    const key = randomUUID();
    const records = await Promise.all(
      Array.from({ length: 50 }, () => storage.increment(key, 60_000, 100, 60_000, 'ip')),
    );
    expect(records.map((r) => r.totalHits).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('prefixos diferentes não se misturam', async () => {
    const key = randomUUID();
    const other = new RedisThrottlerStorage(redis, `${prefix}-b`);
    await storage.increment(key, 60_000, 10, 60_000, 'ip');
    expect((await other.increment(key, 60_000, 10, 60_000, 'ip')).totalHits).toBe(1);
    const keys = await redis.keys(`throttle:${prefix}-b:*`);
    await redis.del(...keys);
  });
});
