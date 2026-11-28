import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { Role } from '../../../src/common/enums/role.enum.js';
import { AUTH_CLOCK } from '../../../src/infra/auth/auth-clock.js';
import { TestClock } from '../../support/auth-clock.js';
import { createCategory } from '../../support/factories.js';
import { createTestApp, type TestApp } from '../../support/test-app.js';
import { createStaff, signInFully, waitForAudit, type Staff } from './example/auth-helpers.js';
import { ExampleAuthModule } from './example/example.module.js';

/**
 * Autorização com o pacote escolhido (US3, T024, FR-012, FR-016 a FR-021): negação por padrão, regras por perfil e
 * por registro, listagem filtrada na consulta, DPO só lê, ninguém altera os próprios perfis, ACCESS_DENIED na trilha.
 */
describe('Autorização: negação por padrão e escopo na consulta (e2e, teste de contrato)', () => {
  let t: TestApp;
  let ds: DataSource;
  const clock = new TestClock();
  const BASE = '/api/admin/v1/example-admin';
  const server = () => t.app.getHttpServer();
  const sessions = new Map<string, string>();

  const staff = async (...roles: Role[]): Promise<Staff & { cookie: string }> => {
    const s = await createStaff(t.app, roles, { nowMs: clock.now() });
    clock.advance(30_000);
    const cookie = await signInFully(t.app, s, clock.now());
    sessions.set(s.id, cookie);
    return { ...s, cookie };
  };

  const newReport = async (assignedTo: string | null): Promise<string> => {
    const category = await createCategory(ds);
    const rows = (await ds.query(
      `INSERT INTO reports (protocol, access_key_hash, reporter_type, category_id, assigned_to_id)
       VALUES ('DV-' || substr(md5(random()::text), 1, 10), 'x', 'EMPLOYEE', $1, $2) RETURNING id`,
      [category.id, assignedTo],
    )) as Array<{ id: string }>;
    return rows[0].id;
  };

  beforeAll(async () => {
    t = await createTestApp({
      vault: 'api',
      imports: [ExampleAuthModule],
      overrides: [{ provide: AUTH_CLOCK, useValue: clock }],
    });
    ds = t.app.get<DataSource>(getDataSourceToken());
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('rota sem regra declarada: 403 para quem está logado, e listada na inicialização', async () => {
    const manager = await staff(Role.COMPLIANCE_MANAGER);
    await request(server()).get(`${BASE}/no-rule`).set('Cookie', manager.cookie).expect(403);
    expect(t.logs.text()).toContain('ExampleAdminController.noRule');
  });

  it('regra "só Gestor": Analista 403, Gestor 200', async () => {
    const analyst = await staff(Role.ANALYST);
    const manager = await staff(Role.COMPLIANCE_MANAGER);
    await request(server()).get(`${BASE}/manager-only`).set('Cookie', analyst.cookie).expect(403);
    await request(server()).get(`${BASE}/manager-only`).set('Cookie', manager.cookie).expect(200);
  });

  it('perfil retirado vale na requisição seguinte (FR-012)', async () => {
    const manager = await staff(Role.COMPLIANCE_MANAGER);
    await request(server()).get(`${BASE}/manager-only`).set('Cookie', manager.cookie).expect(200);
    await ds.query(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'COMPLIANCE_MANAGER'`, [manager.id]);
    await request(server()).get(`${BASE}/manager-only`).set('Cookie', manager.cookie).expect(403);
  });

  it('Analista lista só as atribuídas a ele e sem a bloqueada, com o filtro já na consulta', async () => {
    const analyst = await staff(Role.ANALYST);
    const other = await staff(Role.ANALYST);
    const mine = await newReport(analyst.id);
    const blocked = await newReport(analyst.id);
    const notMine = await newReport(other.id);
    await ds.query(`INSERT INTO report_access_blocks (report_id, user_id, created_by_id) VALUES ($1, $2, $2)`, [
      blocked,
      analyst.id,
    ]);
    const sqls: string[] = [];
    const original = ds.query.bind(ds);
    ds.query = ((sql: string, params?: unknown[]) => {
      sqls.push(sql);
      return original(sql, params);
    }) as typeof ds.query;
    let ids: string[];
    try {
      const res = await request(server()).get(`${BASE}/reports`).set('Cookie', analyst.cookie).expect(200);
      ids = (res.body as { ids: string[] }).ids;
    } finally {
      ds.query = original;
    }
    expect(ids).toContain(mine);
    expect(ids).not.toContain(blocked);
    expect(ids).not.toContain(notMine);
    const listing = sqls.find((s) => s.includes('FROM reports r WHERE'))!;
    expect(listing).toContain('r.assigned_to_id =');
    expect(listing).toContain('report_access_blocks');
  });

  it('DPO lê, mas recebe 403 ao tratar (D20)', async () => {
    const dpo = await staff(Role.DPO);
    const report = await newReport(null);
    await request(server()).get(`${BASE}/reports/${report}`).set('Cookie', dpo.cookie).expect(200);
    await request(server()).post(`${BASE}/reports/${report}/treat`).set('Cookie', dpo.cookie).expect(403);
  });

  it('ninguém altera os próprios perfis (D21); outro Administrador pode', async () => {
    const admin = await staff(Role.ADMIN);
    const target = await staff(Role.ANALYST);
    await request(server()).put(`${BASE}/users/${admin.id}/roles`).set('Cookie', admin.cookie).expect(403);
    await request(server()).put(`${BASE}/users/${target.id}/roles`).set('Cookie', admin.cookie).expect(204);
  });

  it('toda negação grava ACCESS_DENIED, sem conteúdo de denúncia', async () => {
    const analyst = await staff(Role.ANALYST);
    const report = await newReport(null);
    await request(server()).get(`${BASE}/manager-only`).set('Cookie', analyst.cookie).expect(403);
    await request(server()).get(`${BASE}/reports/${report}`).set('Cookie', analyst.cookie).expect(403);
    const deadline = Date.now() + 3_000;
    let rows = await waitForAudit(t.app, analyst.id, 'ACCESS_DENIED');
    while (rows.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      rows = await waitForAudit(t.app, analyst.id, 'ACCESS_DENIED');
    }
    expect(rows.map((r) => r.metadata)).toEqual(
      expect.arrayContaining([
        { policy: 'ExamplePolicy', ability: 'manage' },
        { policy: 'ExamplePolicy', ability: 'read' },
      ]),
    );
    expect(rows.every((r) => r.result === 'DENIED')).toBe(true);
  });

  it('sem sessão: 401, não 403', async () => {
    await request(server()).get(`${BASE}/manager-only`).expect(401);
    await request(server()).get(`${BASE}/no-rule`).expect(401);
  });
});
