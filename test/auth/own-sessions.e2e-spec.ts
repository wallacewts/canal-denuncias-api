import request from 'supertest';
import { Role } from '../../src/common/enums/role.enum.js';
import { rawSetCookie, sessionCookie } from '../contract/auth/example/auth-helpers.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import type { DataSource } from 'typeorm';
import { auditRows, createAuthApp, ME, signIn, signInReal, staffWithMfa, waitRows } from './support.js';

const SESSIONS = '/api/admin/v1/me/sessions';
interface OwnSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

/** US4 (T032): ver e encerrar as próprias sessões. */
describe('Sessões da própria pessoa (e2e)', () => {
  let t: TestApp & { clock: TestClock; ds: DataSource };
  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createAuthApp();
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const twoSessions = async () => {
    const staff = await staffWithMfa(t, Role.ANALYST);
    const a = await signInReal(t.app, staff, t.clock.now());
    t.clock.advance(30_000);
    const b = await signInReal(t.app, staff, t.clock.now());
    return { staff, a, b };
  };

  it('lista as duas com a atual marcada, sem o id do cookie nem o id interno', async () => {
    const { staff, a } = await twoSessions();
    const res = await request(server()).get(SESSIONS).set('Cookie', a).set('User-Agent', 'Navegador XQZ').expect(200);
    const list = res.body as OwnSession[];
    expect(list).toHaveLength(2);
    for (const s of list) {
      expect(Object.keys(s).sort()).toEqual(['createdAt', 'current', 'id', 'ip', 'lastActiveAt', 'userAgent']);
      expect(s.id).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(list.filter((s) => s.current)).toHaveLength(1);
    const internal = (await t.ds.query(`SELECT id FROM sessions WHERE user_id = $1`, [staff.id])) as Array<{
      id: string;
    }>;
    for (const { id } of internal) expect(res.text).not.toContain(id);
    expect(res.text).not.toContain(a.split('=')[1]);
  });

  it('encerra a outra sessão e a atual continua', async () => {
    const { a, b } = await twoSessions();
    const list = (await request(server()).get(SESSIONS).set('Cookie', a).expect(200)).body as OwnSession[];
    const other = list.find((s) => !s.current)!;
    await request(server()).delete(`${SESSIONS}/${other.id}`).set('Cookie', a).expect(204);
    await request(server()).get(ME).set('Cookie', b).expect(401);
    await request(server()).get(ME).set('Cookie', a).expect(200);
  });

  it('id de sessão de outra pessoa, inexistente ou malformado: 404 ou 400', async () => {
    const mine = await twoSessions();
    const theirs = await twoSessions();
    const list = (await request(server()).get(SESSIONS).set('Cookie', theirs.a).expect(200)).body as OwnSession[];
    await request(server()).delete(`${SESSIONS}/${list[0].id}`).set('Cookie', mine.a).expect(404);
    await request(server()).get(ME).set('Cookie', theirs.a).expect(200);
    await request(server())
      .delete(`${SESSIONS}/${'0'.repeat(32)}`)
      .set('Cookie', mine.a)
      .expect(404);
    await request(server()).delete(`${SESSIONS}/XQZ`).set('Cookie', mine.a).expect(400);
  });

  it('encerrar todas: nenhuma vale, cookie apagado e AUTH_SESSION_REVOKED', async () => {
    const { staff, a, b } = await twoSessions();
    const res = await request(server()).delete(SESSIONS).set('Cookie', a).expect(204);
    expect(sessionCookie(res)).toBeNull();
    expect(rawSetCookie(res)).toBeDefined();
    await request(server()).get(ME).set('Cookie', a).expect(401);
    await request(server()).get(ME).set('Cookie', b).expect(401);
    const rows = await waitRows(() => auditRows(t.ds, 'AUTH_SESSION_REVOKED', 'actor_user_id = $2', [staff.id]));
    expect((rows[0] as { metadata: unknown }).metadata).toEqual({ scope: 'all' });
  });

  it('sessão pendente: 401', async () => {
    const staff = await staffWithMfa(t, Role.DPO);
    const cookie = sessionCookie(await signIn(t.app, staff.email, staff.password).expect(200))!;
    await request(server()).get(SESSIONS).set('Cookie', cookie).expect(401);
    await request(server()).delete(SESSIONS).set('Cookie', cookie).expect(401);
  });
});
