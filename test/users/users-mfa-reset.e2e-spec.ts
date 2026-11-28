import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { PgMfaStore } from '../../src/infra/auth/stores/pg-mfa.store.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import { createUsersApp, staffWithSession, type StaffSession } from './support.js';

const BASE = '/api/admin/v1/users';
const ME = '/api/admin/v1/me';

/** US4 (T031): reset do MFA de outra pessoa. */
describe('Equipe: reset do MFA (e2e)', () => {
  let t: TestApp & { clock: TestClock };
  let ds: DataSource;
  let admin: StaffSession;
  const server = () => t.app.getHttpServer();
  const reset = (id: string, cookie = admin.cookie) =>
    request(server()).post(`${BASE}/${id}/mfa-reset`).set('Cookie', cookie);
  const mfaState = async (id: string) =>
    (
      (await ds.query(
        `SELECT mfa_secret_enc IS NOT NULL AS secret, mfa_enabled_at IS NOT NULL AS enabled,
                (SELECT count(*)::int FROM recovery_codes WHERE user_id = $1) AS codes,
                (SELECT count(*)::int FROM sessions WHERE user_id = $1) AS sessions
           FROM users WHERE id = $1`,
        [id],
      )) as Array<{ secret: boolean; enabled: boolean; codes: number; sessions: number }>
    )[0];
  const resetLogs = async (id: string) =>
    (await ds.query(
      `SELECT actor_type::text, actor_user_id::text, metadata FROM audit_logs
        WHERE action = 'USER_MFA_RESET' AND resource_id = $1`,
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

  it('apaga autenticador e códigos, derruba a sessão e registra', async () => {
    const target = await staffWithSession(t, Role.ANALYST);
    await t.app.get(PgMfaStore).saveRecoveryCodes(target.id, ['h1', 'h2']);
    expect(await mfaState(target.id)).toMatchObject({ secret: true, enabled: true, codes: 2 });
    await reset(target.id).expect(204);
    expect(await mfaState(target.id)).toEqual({ secret: false, enabled: false, codes: 0, sessions: 0 });
    await request(server()).get(ME).set('Cookie', target.cookie).expect(401);
    expect(await resetLogs(target.id)).toEqual([{ actor_type: 'STAFF', actor_user_id: admin.id, metadata: null }]);
  });

  it('o próprio MFA: 403 e nada muda', async () => {
    await reset(admin.id).expect(403);
    expect(await mfaState(admin.id)).toMatchObject({ secret: true, enabled: true });
    expect(await resetLogs(admin.id)).toEqual([]);
  });

  it('pessoa sem MFA: 204 e registro (idempotente)', async () => {
    const target = await staffWithSession(t, Role.DPO);
    await reset(target.id).expect(204);
    await reset(target.id).expect(204);
    expect(await resetLogs(target.id)).toHaveLength(2);
  });

  it('outro perfil: 403; inexistente: 404; malformado: 400; sem sessão: 401', async () => {
    const manager = await staffWithSession(t, Role.COMPLIANCE_MANAGER);
    const target = await staffWithSession(t, Role.DPO);
    await reset(target.id, manager.cookie).expect(403);
    expect(await mfaState(target.id)).toMatchObject({ secret: true });
    await reset('01900000-0000-7000-8000-00000000dead').expect(404);
    await reset('XQZ').expect(400);
    await request(server()).post(`${BASE}/${target.id}/mfa-reset`).expect(401);
  });

  it('Administrador bloqueado no meio da própria requisição: 403 e nada muda', async () => {
    const actor = await staffWithSession(t, Role.ADMIN);
    const target = await staffWithSession(t, Role.DPO);
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`UPDATE users SET status = 'BLOCKED' WHERE id = $1`, [actor.id]);
      const pending = reset(target.id, actor.cookie).then((r) => r);
      await new Promise((r) => setTimeout(r, 400));
      await runner.commitTransaction();
      expect((await pending).status).toBe(403);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    expect(await mfaState(target.id)).toMatchObject({ secret: true, enabled: true });
  });
});
