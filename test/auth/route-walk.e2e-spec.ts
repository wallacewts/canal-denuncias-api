import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { Role } from '../../src/common/enums/role.enum.js';
import { createStaff, sessionCookie, totp } from '../contract/auth/example/auth-helpers.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import type { DataSource } from 'typeorm';
import { challenge, createAuthApp, signIn } from './support.js';

const ALL_ROLES = Object.values(Role);
/** Abertas antes da sessão completa (OpenAdminRoute). */
const OPEN = new Set([
  'POST /api/admin/v1/auth/sign-in',
  'POST /api/admin/v1/auth/mfa/challenge',
  'POST /api/admin/v1/auth/sign-out',
]);
/** Liberadas com troca obrigatória pendente (R11). */
const DURING_CHANGE = new Set(['PUT /api/admin/v1/me/password', 'GET /api/admin/v1/me']);

/** Todas as rotas administrativas, do contrato publicado (o CI confere que ele está em dia com o código). */
function adminRoutes(): Array<{ method: string; path: string; key: string }> {
  const doc = JSON.parse(readFileSync(join(import.meta.dirname, '../../openapi/admin.json'), 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  return Object.entries(doc.paths).flatMap(([path, ops]) =>
    Object.keys(ops).map((method) => {
      const real = path.replace(/\{[^}]+\}/g, '01900000-0000-7000-8000-000000000001');
      return { method: method.toUpperCase(), path: real, key: `${method.toUpperCase()} ${path}` };
    }),
  );
}

/** SC-004 (T023, G1): nenhuma rota administrativa abre antes da sessão verificada e da troca obrigatória. */
describe('Varredura das rotas administrativas (e2e)', () => {
  let t: TestApp & { clock: TestClock; ds: DataSource };
  const call = (method: string, path: string, cookie: string) =>
    request(t.app.getHttpServer())[method.toLowerCase() as 'get'](path).set('Cookie', cookie).send({});

  beforeAll(async () => {
    t = await createAuthApp();
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('o contrato tem rotas a varrer', () => {
    expect(adminRoutes().length).toBeGreaterThan(5);
  });

  it('sessão com segundo fator pendente: 401 em todas as rotas fechadas', async () => {
    const staff = await createStaff(t.app, ALL_ROLES, { nowMs: t.clock.now() });
    t.clock.advance(60_000);
    const cookie = sessionCookie(await signIn(t.app, staff.email, staff.password).expect(200))!;
    for (const route of adminRoutes()) {
      if (OPEN.has(`${route.method} ${route.path}`)) continue;
      const res = await call(route.method, route.path, cookie);
      expect([route.key, res.status]).toEqual([route.key, 401]);
    }
  });

  it('sessão verificada com troca pendente: 403 com código em todas, exceto as liberadas', async () => {
    const staff = await createStaff(t.app, ALL_ROLES, { nowMs: t.clock.now(), passwordChanged: false });
    t.clock.advance(60_000);
    const first = sessionCookie(await signIn(t.app, staff.email, staff.password).expect(200))!;
    const cookie = sessionCookie(
      await challenge(t.app, first, { code: totp(staff.secret!, t.clock.now()) }).expect(200),
    )!;
    for (const route of adminRoutes()) {
      const key = `${route.method} ${route.path}`;
      if (OPEN.has(key) || DURING_CHANGE.has(key)) continue;
      const res = await call(route.method, route.path, cookie);
      expect([route.key, res.status]).toEqual([route.key, 403]);
      expect([route.key, (res.body as { code?: string }).code]).toEqual([
        route.key,
        expect.stringMatching(/^(PASSWORD_CHANGE_REQUIRED|STEP_NOT_ALLOWED)$/),
      ]);
    }
  });
});
