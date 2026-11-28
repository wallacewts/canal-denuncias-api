import { Controller, Get, Module } from '@nestjs/common';
import { AuthenticationModule, AuthenticationRegistry, SessionCookieProvider } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { Role } from '../../../src/common/enums/role.enum.js';
import { AUTH_CLOCK } from '../../../src/infra/auth/auth-clock.js';
import { PgSessionStore } from '../../../src/infra/auth/stores/pg-session.store.js';
import { HOUR, MINUTE, TestClock } from '../../support/auth-clock.js';
import { createTestApp, type TestApp } from '../../support/test-app.js';
import { createStaff, signInFully, waitForAudit, type Staff } from './example/auth-helpers.js';
import { ExampleAuthModule } from './example/example.module.js';

/** Expirações, persistência e encerramento de sessões (US2, T021, FR-008 a FR-010, FR-012, SC-003 a SC-005). */
describe('Sessão: expirações, persistência e encerramento (e2e, teste de contrato)', () => {
  let t: TestApp;
  let ds: DataSource;
  const clock = new TestClock();
  const ME = '/api/admin/v1/example-auth/me';
  const server = () => t.app.getHttpServer();

  const options = () => ({
    vault: 'api' as const,
    imports: [ExampleAuthModule],
    overrides: [{ provide: AUTH_CLOCK, useValue: clock }],
  });

  beforeAll(async () => {
    t = await createTestApp(options());
    ds = t.app.get<DataSource>(getDataSourceToken());
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const newStaff = async (): Promise<Staff> => {
    const staff = await createStaff(t.app, [Role.ANALYST], { nowMs: clock.now() });
    clock.advance(30_000);
    return staff;
  };

  it('401 depois de 15 min sem uso', async () => {
    const cookie = await signInFully(t.app, await newStaff(), clock.now());
    clock.advance(14 * MINUTE);
    await request(server()).get(ME).set('Cookie', cookie).expect(200);
    clock.advance(16 * MINUTE);
    await request(server()).get(ME).set('Cookie', cookie).expect(401);
  });

  it('401 depois de 8 h mesmo com uso contínuo', async () => {
    const cookie = await signInFully(t.app, await newStaff(), clock.now());
    let last = 200;
    let elapsed = 0;
    while (last === 200 && elapsed < 9 * HOUR) {
      clock.advance(10 * MINUTE);
      elapsed += 10 * MINUTE;
      last = (await request(server()).get(ME).set('Cookie', cookie)).status;
    }
    expect(last).toBe(401);
    expect(elapsed).toBeGreaterThan(7 * HOUR + 50 * MINUTE);
    expect(elapsed).toBeLessThanOrEqual(8 * HOUR);
  });

  it('relógio recuado não renova a sessão: o limite de 8 h conta do login (caso de borda C3)', async () => {
    const staff = await newStaff();
    const start = clock.now();
    const cookie = await signInFully(t.app, staff, start);
    for (let i = 0; i < 47; i++) {
      clock.advance(10 * MINUTE);
      await request(server()).get(ME).set('Cookie', cookie).expect(200);
    }
    const [before] = (await ds.query(`SELECT expires_at, last_active_at FROM sessions WHERE user_id = $1`, [
      staff.id,
    ])) as Array<{ expires_at: Date; last_active_at: Date }>;
    clock.advance(-2 * HOUR);
    await request(server()).get(ME).set('Cookie', cookie).expect(200);
    const [after] = (await ds.query(`SELECT expires_at, last_active_at FROM sessions WHERE user_id = $1`, [
      staff.id,
    ])) as Array<{ expires_at: Date; last_active_at: Date }>;
    expect(after.expires_at).toEqual(before.expires_at);
    expect(after.last_active_at).toEqual(before.last_active_at);
    clock.advance(start + 8 * HOUR + MINUTE - clock.now());
    await request(server()).get(ME).set('Cookie', cookie).expect(401);
  });

  it('a sessão continua válida depois de reiniciar a API (está no Postgres)', async () => {
    const cookie = await signInFully(t.app, await newStaff(), clock.now());
    const restarted = await createTestApp({ ...options(), database: t.database });
    try {
      await request(restarted.app.getHttpServer()).get(ME).set('Cookie', cookie).expect(200);
    } finally {
      await restarted.close();
    }
  });

  it('em produção, o pacote recusa subir com sessões em memória', async () => {
    @Injectable()
    class MemorySessions extends SessionCookieProvider<{ id: string }> {
      constructor(registry: AuthenticationRegistry) {
        super();
        registry.registerProvider(this);
      }
      validate() {
        return null;
      }
    }
    @Controller('x')
    class X {
      @Get()
      get() {
        return {};
      }
    }
    @Module({
      imports: [AuthenticationModule.forRoot({ session: {} })],
      controllers: [X],
      providers: [MemorySessions],
    })
    class ProdLike {}
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(
        (async () => {
          const ref = await Test.createTestingModule({ imports: [ProdLike] }).compile();
          const app = ref.createNestApplication({ logger: false });
          try {
            await app.init();
          } finally {
            await app.close();
          }
        })(),
      ).rejects.toThrow(/production/i);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('falha do store no login não deixa sessão em memória', async () => {
    const staff = await newStaff();
    const store = t.app.get(PgSessionStore);
    const original = store.createSession.bind(store);
    store.createSession = () => Promise.reject(new Error('banco indisponível'));
    try {
      const res = await request(server())
        .post('/api/admin/v1/example-auth/sign-in')
        .send({ email: staff.email, password: staff.password });
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).some((c) => c.includes('sid='))).toBe(false);
    } finally {
      store.createSession = original;
    }
  });

  it('sair de todos os lugares encerra todas as sessões do usuário e grava AUTH_SESSION_REVOKED', async () => {
    const staff = await newStaff();
    const a = await signInFully(t.app, staff, clock.now());
    clock.advance(30_000);
    const b = await signInFully(t.app, staff, clock.now());
    await request(server()).get(ME).set('Cookie', a).expect(200);
    await request(server()).get(ME).set('Cookie', b).expect(200);
    await request(server()).post('/api/admin/v1/example-auth/sign-out-everywhere').set('Cookie', a).expect(204);
    await request(server()).get(ME).set('Cookie', a).expect(401);
    await request(server()).get(ME).set('Cookie', b).expect(401);
    const rows = await waitForAudit(t.app, staff.id, 'AUTH_SESSION_REVOKED');
    expect(rows[0]?.metadata).toEqual({ scope: 'all' });
  });

  it('usuário desativado é recusado na requisição seguinte', async () => {
    const staff = await newStaff();
    const cookie = await signInFully(t.app, staff, clock.now());
    await request(server()).get(ME).set('Cookie', cookie).expect(200);
    await ds.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [staff.id]);
    await request(server()).get(ME).set('Cookie', cookie).expect(401);
  });
});
