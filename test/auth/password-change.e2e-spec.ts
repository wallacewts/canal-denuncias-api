import request from 'supertest';
import { Role } from '../../src/common/enums/role.enum.js';
import { sessionCookie } from '../contract/auth/example/auth-helpers.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import type { DataSource } from 'typeorm';
import { auditRows, createAuthApp, ME, signInReal, staffWithMfa, waitRows } from './support.js';

const PASSWORD = '/api/admin/v1/me/password';
const NEW_PASSWORD = 'uma frase nova bem comprida XQZ';

/** US3 (T022): troca de senha com códigos, limite de 5 erros, sessões e nada vazado. */
describe('Troca de senha (e2e)', () => {
  let t: TestApp & { clock: TestClock; ds: DataSource };
  const server = () => t.app.getHttpServer();
  const change = (cookie: string, body: object) => request(server()).put(PASSWORD).set('Cookie', cookie).send(body);
  const sessionsOf = async (id: string) =>
    ((await t.ds.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1`, [id])) as Array<{ n: number }>)[0]
      .n;

  beforeAll(async () => {
    t = await createAuthApp();
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const session = async () => {
    const staff = await staffWithMfa(t, Role.ANALYST);
    const cookie = await signInReal(t.app, staff, t.clock.now());
    return { staff, cookie };
  };

  it('sucesso: nextStep, horários, cookie novo, a outra sessão cai e AUTH_PASSWORD_CHANGED', async () => {
    const { staff, cookie } = await session();
    t.clock.advance(30_000);
    const other = await signInReal(t.app, staff, t.clock.now());
    const res = await change(cookie, { currentPassword: staff.password, newPassword: NEW_PASSWORD }).expect(200);
    expect(Object.keys(res.body as object).sort()).toEqual(['absoluteExpiresAt', 'idleExpiresAt', 'nextStep']);
    expect(res.body).toMatchObject({ nextStep: 'DONE' });
    const fresh = sessionCookie(res)!;
    expect(fresh).not.toBe(cookie);
    await request(server()).get(ME).set('Cookie', fresh).expect(200);
    await request(server()).get(ME).set('Cookie', cookie).expect(401);
    await request(server()).get(ME).set('Cookie', other).expect(401);
    expect(await auditRows(t.ds, 'AUTH_PASSWORD_CHANGED', 'resource_id = $2', [staff.id])).toHaveLength(1);
    const [row] = (await t.ds.query(`SELECT password_changed_at FROM users WHERE id = $1`, [staff.id])) as Array<{
      password_changed_at: Date | null;
    }>;
    expect(row.password_changed_at).not.toBeNull();
  });

  it.each([
    ['curta', 'curta', 'PASSWORD_TOO_SHORT'],
    ['comum', 'password1234', 'PASSWORD_COMMON'],
  ])('senha nova %s: 422 com o código da regra e não conta para o limite', async (_caso, newPassword, code) => {
    const { staff, cookie } = await session();
    for (let i = 0; i < 6; i++) {
      const res = await change(cookie, { currentPassword: staff.password, newPassword }).expect(422);
      expect(res.body).toMatchObject({ code });
    }
    await request(server()).get(ME).set('Cookie', cookie).expect(200);
  });

  it('senha nova igual à atual: 422 PASSWORD_SAME_AS_CURRENT', async () => {
    const { staff, cookie } = await session();
    const res = await change(cookie, { currentPassword: staff.password, newPassword: staff.password }).expect(422);
    expect(res.body).toMatchObject({ code: 'PASSWORD_SAME_AS_CURRENT' });
  });

  it('senha atual errada: 422 do 1º ao 4º; o 5º dá 429 e encerra a sessão', async () => {
    const { staff, cookie } = await session();
    for (let i = 1; i <= 4; i++) {
      const res = await change(cookie, { currentPassword: `errada-${i}-XQZ`, newPassword: NEW_PASSWORD }).expect(422);
      expect(res.body).toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' });
    }
    const fifth = await change(cookie, { currentPassword: 'errada-5-XQZ', newPassword: NEW_PASSWORD }).expect(429);
    expect(sessionCookie(fifth)).toBeNull();
    expect(await sessionsOf(staff.id)).toBe(0);
    await request(server()).get(ME).set('Cookie', cookie).expect(401);
    const rows = (await waitRows(
      () => auditRows(t.ds, 'AUTH_PASSWORD_CHANGE_FAILED', 'resource_id = $2', [staff.id]),
      5,
    )) as Array<{ metadata: unknown }>;
    expect(rows.map((r) => r.metadata)).toEqual(
      [1, 2, 3, 4, 5].map((attempt) => ({
        reason: 'CURRENT_PASSWORD_INVALID',
        attempt,
        locked: attempt === 5,
      })),
    );
    const trail = JSON.stringify(await t.ds.query(`SELECT * FROM audit_logs`));
    for (const text of [trail, t.logs.text(), fifth.text]) {
      expect(text).not.toContain('XQZ');
      expect(text).not.toContain(staff.password);
    }
  });

  it('5 simultâneas com a senha atual errada: a sessão é encerrada uma única vez', async () => {
    const { staff, cookie } = await session();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => change(cookie, { currentPassword: 'errada', newPassword: NEW_PASSWORD })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([422, 422, 422, 422, 429]);
    expect(await sessionsOf(staff.id)).toBe(0);
    const out = (await waitRows(() =>
      auditRows(t.ds, 'AUTH_SIGNED_OUT', 'actor_user_id = $2', [staff.id]),
    )) as unknown[];
    expect(out).toHaveLength(1);
  });

  it('uma sessão nova começa o contador do zero', async () => {
    const { staff, cookie } = await session();
    for (let i = 0; i < 4; i++)
      await change(cookie, { currentPassword: 'errada', newPassword: NEW_PASSWORD }).expect(422);
    t.clock.advance(30_000);
    const fresh = await signInReal(t.app, staff, t.clock.now());
    await change(fresh, { currentPassword: 'errada', newPassword: NEW_PASSWORD }).expect(422);
    await request(server()).get(ME).set('Cookie', fresh).expect(200);
  });

  it('sem sessão: 401; corpo inválido: 400', async () => {
    await request(server()).put(PASSWORD).send({ currentPassword: 'a', newPassword: 'b' }).expect(401);
    const { cookie } = await session();
    await change(cookie, { currentPassword: 'a' }).expect(400);
  });
});
