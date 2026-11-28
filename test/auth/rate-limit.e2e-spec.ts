import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import request from 'supertest';
import { Role } from '../../src/common/enums/role.enum.js';
import { AUTH_RATE_LIMITS, type AuthRateLimits } from '../../src/infra/throttle/auth-rate-limits.js';
import { sessionCookie } from '../contract/auth/example/auth-helpers.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import type { DataSource } from 'typeorm';
import { createAuthApp, staffWithMfa } from './support.js';

const SIGN_IN = '/api/admin/v1/auth/sign-in';
const CHALLENGE = '/api/admin/v1/auth/mfa/challenge';

/** US5 (T035, R4): limite por IP e por conta em sign-in e no desafio, com Retry-After e sem e-mail no Redis. */
describe('Limite de tentativas (e2e)', () => {
  const prefix = `t-${randomUUID()}`;
  const limits: AuthRateLimits = { prefix, ip: { limit: 5, ttlMs: 60_000 }, account: { limit: 3, ttlMs: 60_000 } };
  let t: TestApp & { clock: TestClock; ds: DataSource };
  let ipCounter = 0;
  const freshIp = () => `203.0.113.${++ipCounter}`;
  const signIn = (email: string, ip: string) =>
    request(t.app.getHttpServer()).post(SIGN_IN).set('X-Forwarded-For', ip).send({ email, password: 'errada-XQZ' });

  beforeAll(async () => {
    t = await createAuthApp(undefined, { overrides: [{ provide: AUTH_RATE_LIMITS, useValue: limits }] });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('por IP: passado o limite, 429 com Retry-After e a mesma mensagem para quem tentar', async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await signIn(`ip.${i}@empresa.test`, ip).expect(401);
    const res = await signIn('ip.extra@empresa.test', ip).expect(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(res.body).toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
    // Outro IP continua entrando.
    await signIn('ip.outro@empresa.test', freshIp()).expect(401);
  });

  it('por conta: igual para e-mail existente e inexistente, de IPs diferentes', async () => {
    const staff = await staffWithMfa(t, Role.ANALYST);
    for (const email of [staff.email, `ninguem.${randomUUID()}@empresa.test`]) {
      for (let i = 0; i < 3; i++) await signIn(email, freshIp()).expect(401);
      await signIn(email, freshIp()).expect(429);
      await signIn(` ${email.toUpperCase()} `, freshIp()).expect(429);
    }
  });

  it('desafio: limite por sessão pendente', async () => {
    const staff = await staffWithMfa(t, Role.ANALYST);
    const first = await request(t.app.getHttpServer())
      .post(SIGN_IN)
      .set('X-Forwarded-For', freshIp())
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    const cookie = sessionCookie(first)!;
    const challenge = () =>
      request(t.app.getHttpServer())
        .post(CHALLENGE)
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie)
        .send({ code: '000000' });
    for (let i = 0; i < 3; i++) await challenge().expect(422);
    await challenge().expect(429);
  });

  it('as chaves no Redis não contêm o e-mail', async () => {
    const email = `chave.${randomUUID()}@empresa.test`;
    await signIn(email, freshIp()).expect(401);
    const redis = new Redis(process.env.REDIS_URL!);
    try {
      const keys = await redis.keys(`throttle:${prefix}:*`);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(key).not.toContain(email.split('@')[0]);
    } finally {
      await redis.quit();
    }
  });

  it('duas instâncias da API somam o mesmo contador', async () => {
    const other = await createAuthApp(undefined, { overrides: [{ provide: AUTH_RATE_LIMITS, useValue: limits }] });
    try {
      const ip = freshIp();
      for (let i = 0; i < 3; i++) await signIn(`dup.${i}@empresa.test`, ip).expect(401);
      for (let i = 3; i < 5; i++) {
        await request(other.app.getHttpServer())
          .post(SIGN_IN)
          .set('X-Forwarded-For', ip)
          .send({ email: `dup.${i}@empresa.test`, password: 'x' })
          .expect(401);
      }
      await signIn('dup.extra@empresa.test', ip).expect(429);
    } finally {
      await other.close();
    }
  });
});
