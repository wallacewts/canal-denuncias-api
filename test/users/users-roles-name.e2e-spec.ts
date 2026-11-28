import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { abilitiesFor } from '../../src/modules/access-control/abilities.js';
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

/** US3 (T026): perfis com D21 e último Administrador sob concorrência; nome sem o valor na trilha. */
describe('Equipe: perfis e nome (e2e)', () => {
  let t: TestApp & { clock: TestClock };
  let ds: DataSource;
  let admin: StaffSession;
  const server = () => t.app.getHttpServer();
  const setRoles = (id: string, roles: Role[], cookie = admin.cookie) =>
    request(server()).put(`${BASE}/${id}/roles`).set('Cookie', cookie).send({ roles });
  const rolesOf = async (id: string) =>
    (
      (await ds.query(`SELECT role::text FROM user_roles WHERE user_id = $1 ORDER BY role`, [id])) as Array<{
        role: string;
      }>
    ).map((r) => r.role);
  const logs = async (action: string, id: string) =>
    (await ds.query(`SELECT actor_user_id::text, metadata FROM audit_logs WHERE action = $1 AND resource_id = $2`, [
      action,
      id,
    ])) as Array<{ actor_user_id: string; metadata: unknown }>;

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

  it('trocar os próprios perfis: 403 e nada muda', async () => {
    await setRoles(admin.id, [Role.ADMIN, Role.ANALYST]).expect(403);
    expect(await rolesOf(admin.id)).toEqual(['ADMIN']);
  });

  it('Administrador acumula perfil que lê denúncias, concedido por outro (D21), e vale na requisição seguinte', async () => {
    const other = await staffWithSession(t, Role.ADMIN);
    const res = await setRoles(other.id, [Role.ANALYST, Role.ADMIN]).expect(200);
    expect(res.body).toMatchObject({ roles: [Role.ADMIN, Role.ANALYST] });
    const me = await request(server()).get('/api/admin/v1/me').set('Cookie', other.cookie).expect(200);
    expect((me.body as { abilities: string[] }).abilities).toEqual(abilitiesFor([Role.ADMIN, Role.ANALYST]));
    expect(await logs('USER_ROLES_CHANGED', other.id)).toEqual([
      { actor_user_id: admin.id, metadata: { before: ['ADMIN'], after: ['ADMIN', 'ANALYST'] } },
    ]);
  });

  it('mesmo conjunto: 200 sem registro', async () => {
    const target = await staffWithSession(t, Role.DPO, Role.AUDITOR);
    await setRoles(target.id, [Role.AUDITOR, Role.DPO]).expect(200);
    expect(await logs('USER_ROLES_CHANGED', target.id)).toEqual([]);
  });

  it('retirar ANALYST de quem tem denúncia aberta: 409 com a quantidade', async () => {
    const analyst = await staffWithSession(t, Role.ANALYST, Role.DPO);
    await insertReport(ds, analyst.id, 'IN_TRIAGE');
    const res = await setRoles(analyst.id, [Role.DPO]).expect(409);
    expect(res.body).toMatchObject({ code: 'USER_HAS_ASSIGNED_REPORTS', details: { assignedReports: 1 } });
    expect(await rolesOf(analyst.id)).toEqual(['ANALYST', 'DPO']);
    await setRoles(analyst.id, [Role.ANALYST]).expect(200);
  });

  it('retiradas simultâneas de ADMIN entre os dois últimos: só uma passa e sobra um ativo', async () => {
    for (let round = 0; round < 3; round++) {
      const a = await staffWithSession(t, Role.ADMIN, Role.DPO);
      const b = await staffWithSession(t, Role.ADMIN, Role.DPO);
      await onlyActiveAdmins(ds, a.id, b.id);
      const [ra, rb] = await Promise.all([setRoles(b.id, [Role.DPO], a.cookie), setRoles(a.id, [Role.DPO], b.cookie)]);
      const statuses = [ra.status, rb.status].sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect([403, 409]).toContain(statuses.find((s) => s !== 200));
      expect(await activeAdmins(ds)).toHaveLength(1);
    }
  });

  it('Administrador que perdeu o perfil no meio da própria requisição: 403', async () => {
    const actor = await staffWithSession(t, Role.ADMIN);
    const target = await staffWithSession(t, Role.DPO);
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [actor.id]);
      await runner.query(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'ADMIN'`, [actor.id]);
      const pending = setRoles(target.id, [Role.AUDITOR], actor.cookie).then((r) => r);
      await new Promise((r) => setTimeout(r, 400));
      await runner.commitTransaction();
      expect((await pending).status).toBe(403);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    expect(await rolesOf(target.id)).toEqual(['DPO']);
  });

  it('alterar o nome: USER_UPDATED só com o nome do campo, nunca o valor', async () => {
    const target = await staffWithSession(t, Role.DPO);
    const res = await request(server())
      .patch(`${BASE}/${target.id}`)
      .set('Cookie', admin.cookie)
      .send({ name: ' Nome Novo XQZ ' })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Nome Novo XQZ' });
    expect(await logs('USER_UPDATED', target.id)).toEqual([
      { actor_user_id: admin.id, metadata: { fields: ['name'] } },
    ]);
    expect(JSON.stringify(await ds.query(`SELECT * FROM audit_logs`))).not.toContain('XQZ');
    await request(server())
      .patch(`${BASE}/${target.id}`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Outro', email: 'x@y.z' })
      .expect(400);
  });

  it('perfis inválidos: 400', async () => {
    const target = await staffWithSession(t, Role.DPO);
    await setRoles(target.id, []).expect(400);
    await setRoles(target.id, ['XQZ' as Role]).expect(400);
  });
});
