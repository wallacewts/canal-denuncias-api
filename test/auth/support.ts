import type { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import type { Role } from '../../src/common/enums/role.enum.js';
import { AUTH_CLOCK } from '../../src/infra/auth/auth-clock.js';
import { createStaff, sessionCookie, totp, type Staff } from '../contract/auth/example/auth-helpers.js';
import { TestClock } from '../support/auth-clock.js';
import { createTestApp, type CreateTestAppOptions, type TestApp } from '../support/test-app.js';

export const AUTH = '/api/admin/v1/auth';
export const ME = '/api/admin/v1/me';

/** App com as rotas definitivas de login (feature 006) e relógio controlado. */
export async function createAuthApp(
  clock = new TestClock(),
  extra: Pick<CreateTestAppOptions, 'imports' | 'overrides'> = {},
): Promise<TestApp & { clock: TestClock; ds: DataSource }> {
  const t = await createTestApp({
    vault: 'api',
    imports: extra.imports,
    overrides: [{ provide: AUTH_CLOCK, useValue: clock }, ...(extra.overrides ?? [])],
  });
  return Object.assign(t, { clock, ds: t.app.get<DataSource>(getDataSourceToken()) });
}

/** Pessoa da equipe com autenticador confirmado (o passo usado na confirmação não vale de novo). */
export async function staffWithMfa(t: TestApp & { clock: TestClock }, ...roles: Role[]): Promise<Staff> {
  const staff = await createStaff(t.app, roles, { nowMs: t.clock.now() });
  // Senha já trocada (fora do primeiro acesso) e um passo à frente do usado na confirmação, inclusive para o ±1.
  const ds = t.app.get<DataSource>(getDataSourceToken());
  await ds.query(`UPDATE users SET password_changed_at = now() WHERE id = $1`, [staff.id]);
  t.clock.advance(60_000);
  return staff;
}

export function signIn(app: INestApplication, email: string, password: string) {
  return request(app.getHttpServer()).post(`${AUTH}/sign-in`).send({ email, password });
}

export function challenge(app: INestApplication, cookie: string, body: object) {
  return request(app.getHttpServer()).post(`${AUTH}/mfa/challenge`).set('Cookie', cookie).send(body);
}

/** Entra pelas rotas definitivas (senha e, havendo autenticador, o código) e devolve o cookie final. */
export async function signInReal(app: INestApplication, staff: Staff, nowMs: number): Promise<string> {
  const first = await signIn(app, staff.email, staff.password).expect(200);
  const cookie = sessionCookie(first);
  if (!cookie) throw new Error('sem cookie de sessão');
  if (!staff.secret) return cookie;
  const second = await challenge(app, cookie, { code: totp(staff.secret, nowMs) }).expect(200);
  return sessionCookie(second) ?? cookie;
}

/** Corpo de erro sem o `requestId`, para comparar respostas. */
export function withoutRequestId(body: unknown): unknown {
  const { requestId: _ignored, ...rest } = body as Record<string, unknown>;
  return rest;
}

export async function auditRows(ds: DataSource, action: string, where = 'TRUE', params: unknown[] = []) {
  return (await ds.query(
    `SELECT actor_type::text, actor_user_id::text, resource_id, metadata, result::text FROM audit_logs
      WHERE action = $1 AND ${where} ORDER BY id`,
    [action, ...params],
  )) as Array<{
    actor_type: string;
    actor_user_id: string | null;
    resource_id: string | null;
    metadata: unknown;
    result: string;
  }>;
}

/** Espera os registros gravados pelo assinante (assíncrono). */
export async function waitRows(fn: () => Promise<unknown[]>, min = 1, timeoutMs = 3_000): Promise<unknown[]> {
  const end = Date.now() + timeoutMs;
  let rows = await fn();
  while (rows.length < min && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    rows = await fn();
  }
  return rows;
}
