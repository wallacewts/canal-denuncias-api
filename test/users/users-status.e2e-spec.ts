import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { signInFully } from '../contract/auth/example/auth-helpers.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import {
  activeAdmins,
  createUsersApp,
  insertReport,
  onlyActiveAdmins,
  staffWithSession,
  type StaffSession,
} from './support.js';

const BASE = '/api/admin/v1/users';
const ME = '/api/admin/v1/me';

/** US3 (T025): status com corte imediato, sem agir sobre si, nunca sem Administrador ativo, atribuídas (Q1). */
describe('Equipe: status (e2e)', () => {
  let t: TestApp & { clock: TestClock };
  let ds: DataSource;
  let admin: StaffSession;
  const server = () => t.app.getHttpServer();
  const setStatus = (id: string, status: string, cookie = admin.cookie) =>
    request(server()).put(`${BASE}/${id}/status`).set('Cookie', cookie).send({ status });
  const sessionsOf = async (id: string) =>
    ((await ds.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1`, [id])) as Array<{ n: number }>)[0].n;
  const statusOf = async (id: string) =>
    ((await ds.query(`SELECT status::text FROM users WHERE id = $1`, [id])) as Array<{ status: string }>)[0].status;
  const statusLogs = async (id: string) =>
    (await ds.query(
      `SELECT actor_type::text, actor_user_id::text, metadata FROM audit_logs
        WHERE action = 'USER_STATUS_CHANGED' AND resource_id = $1 ORDER BY id`,
      [id],
    )) as Array<{ actor_type: string; actor_user_id: string; metadata: unknown }>;

  beforeAll(async () => {
    t = await createUsersApp();
    ds = t.app.get<DataSource>(getDataSourceToken());
    admin = await staffWithSession(t, Role.ADMIN);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  /** Os testes de concorrência desativam os outros Administradores direto no banco: o principal volta depois. */
  afterEach(async () => {
    await ds.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [admin.id]);
  });

  it.each(['BLOCKED', 'DISABLED'])(
    '%s: a pessoa perde o acesso na requisição seguinte e nenhuma sessão sobra',
    async (status) => {
      const target = await staffWithSession(t, Role.DPO);
      await request(server()).get(ME).set('Cookie', target.cookie).expect(200);
      const res = await setStatus(target.id, status).expect(200);
      expect(res.body).toMatchObject({ id: target.id, status });
      await request(server()).get(ME).set('Cookie', target.cookie).expect(401);
      expect(await sessionsOf(target.id)).toBe(0);
      expect(await statusLogs(target.id)).toEqual([
        { actor_type: 'STAFF', actor_user_id: admin.id, metadata: { from: 'ACTIVE', to: status } },
      ]);
    },
  );

  it('reativar: entra de novo, mas o cookie antigo continua sem valer', async () => {
    const target = await staffWithSession(t, Role.DPO);
    await setStatus(target.id, 'BLOCKED').expect(200);
    await setStatus(target.id, 'ACTIVE').expect(200);
    await request(server()).get(ME).set('Cookie', target.cookie).expect(401);
    t.clock.advance(30_000);
    const fresh = await signInFully(t.app, target, t.clock.now());
    await request(server()).get(ME).set('Cookie', fresh).expect(200);
  });

  it('mesmo status: 200 sem registro', async () => {
    const target = await staffWithSession(t, Role.DPO);
    await setStatus(target.id, 'ACTIVE').expect(200);
    expect(await statusLogs(target.id)).toEqual([]);
  });

  it('mudar o próprio status: 403 com ACCESS_DENIED', async () => {
    const res = await setStatus(admin.id, 'BLOCKED');
    expect(res.status).toBe(403);
    expect(await statusOf(admin.id)).toBe('ACTIVE');
    let rows: Array<{ metadata: unknown }> = [];
    for (const end = Date.now() + 3_000; rows.length === 0 && Date.now() < end;) {
      rows = (await ds.query(`SELECT metadata FROM audit_logs WHERE action = 'ACCESS_DENIED' AND actor_user_id = $1`, [
        admin.id,
      ])) as Array<{ metadata: unknown }>;
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 50));
    }
    expect(rows.map((r) => r.metadata)).toContainEqual({ policy: 'UsersPolicy', ability: 'actOnOther' });
  });

  it('Analista com denúncia aberta atribuída: desativar dá 409 com a quantidade; bloquear funciona', async () => {
    const analyst = await staffWithSession(t, Role.ANALYST);
    await insertReport(ds, analyst.id);
    await insertReport(ds, analyst.id, 'UNDER_INVESTIGATION');
    await insertReport(ds, analyst.id, 'INVALID');
    const res = await setStatus(analyst.id, 'DISABLED').expect(409);
    expect(res.body).toMatchObject({ code: 'USER_HAS_ASSIGNED_REPORTS', details: { assignedReports: 2 } });
    expect(await statusOf(analyst.id)).toBe('ACTIVE');
    await setStatus(analyst.id, 'BLOCKED').expect(200);
    await setStatus(analyst.id, 'DISABLED').expect(409);
  });

  it('denúncia encerrada atribuída não impede desativar', async () => {
    const analyst = await staffWithSession(t, Role.ANALYST);
    await insertReport(ds, analyst.id, 'ARCHIVED');
    await setStatus(analyst.id, 'DISABLED').expect(200);
  });

  it('os dois únicos Administradores bloqueando um ao outro: só um passa e sobra um ativo (5 vezes)', async () => {
    for (let round = 0; round < 5; round++) {
      const a = await staffWithSession(t, Role.ADMIN);
      const b = await staffWithSession(t, Role.ADMIN);
      await onlyActiveAdmins(ds, a.id, b.id);
      const [ra, rb] = await Promise.all([setStatus(b.id, 'BLOCKED', a.cookie), setStatus(a.id, 'BLOCKED', b.cookie)]);
      const statuses = [ra.status, rb.status].sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect([401, 403, 409]).toContain(statuses.find((s) => s !== 200));
      const remaining = await activeAdmins(ds);
      expect(remaining).toHaveLength(1);
      expect([a.id, b.id]).toContain(remaining[0]);
    }
  });

  it('Administrador bloqueado no meio da própria requisição não aplica a mudança (403)', async () => {
    const actor = await staffWithSession(t, Role.ADMIN);
    const target = await staffWithSession(t, Role.DPO);
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`UPDATE users SET status = 'BLOCKED' WHERE id = $1`, [actor.id]);
      const pending = setStatus(target.id, 'BLOCKED', actor.cookie).then((r) => r);
      await new Promise((r) => setTimeout(r, 400));
      await runner.commitTransaction();
      const res = await pending;
      expect(res.status).toBe(403);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    expect(await statusOf(target.id)).toBe('ACTIVE');
    expect(await statusLogs(target.id)).toEqual([]);
  });

  it('inexistente: 404; status inválido ou campo extra: 400', async () => {
    await setStatus('01900000-0000-7000-8000-00000000dead', 'BLOCKED').expect(404);
    const target = await staffWithSession(t, Role.DPO);
    await setStatus(target.id, 'DELETED').expect(400);
    await request(server())
      .put(`${BASE}/${target.id}/status`)
      .set('Cookie', admin.cookie)
      .send({ status: 'BLOCKED', motivo: 'XQZ' })
      .expect(400);
  });
});
