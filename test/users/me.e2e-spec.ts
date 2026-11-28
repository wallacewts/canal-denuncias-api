import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { abilitiesFor } from '../../src/modules/access-control/abilities.js';
import { currentUserResponseSchema } from '../../src/modules/users/me.schema.js';
import { MINUTE, TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import { createUsersApp, staffWithSession } from './support.js';

const ME = '/api/admin/v1/me';
/** Chaves exatas do `CurrentUser` do front (contracts/me-api.md): o front recusa chave a mais ou a menos. */
const KEYS = [
  'abilities',
  'absoluteExpiresAt',
  'email',
  'id',
  'idleExpiresAt',
  'mfaEnabledAt',
  'name',
  'passwordChangeRequired',
  'roles',
];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** US2 (T021): meu perfil para o backoffice. */
describe('Meu perfil (e2e)', () => {
  let t: TestApp & { clock: TestClock };
  let ds: DataSource;
  const server = () => t.app.getHttpServer();
  const auditCount = async () =>
    ((await ds.query(`SELECT count(*)::int AS n FROM audit_logs`)) as Array<{ n: number }>)[0].n;

  beforeAll(async () => {
    t = await createUsersApp(new TestClock(Date.UTC(2026, 10, 28, 12, 0, 0)));
    ds = t.app.get<DataSource>(getDataSourceToken());
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('devolve exatamente os campos do contrato, sem nada sensível', async () => {
    const staff = await staffWithSession(t, Role.ANALYST);
    const res = await request(server()).get(ME).set('Cookie', staff.cookie).expect(200);
    const body = res.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(body).toMatchObject({
      id: staff.id,
      email: staff.email,
      roles: [Role.ANALYST],
      passwordChangeRequired: false, // senha já trocada (createStaff, feature 006)
      abilities: abilitiesFor([Role.ANALYST]),
    });
    // A resposta real obedece ao schema publicado no OpenAPI (o mesmo comparado com o contrato do front).
    expect(currentUserResponseSchema.safeParse(body).success).toBe(true);
    expect(body.mfaEnabledAt).toMatch(ISO_UTC);
    expect(body.idleExpiresAt).toMatch(ISO_UTC);
    expect(body.absoluteExpiresAt).toMatch(ISO_UTC);
    expect(res.text).not.toMatch(/password_hash|passwordHash|scrypt|secret|recovery|status/i);
  });

  it.each([
    [[Role.ADMIN]],
    [[Role.COMPLIANCE_MANAGER]],
    [[Role.ANALYST]],
    [[Role.DPO]],
    [[Role.AUDITOR]],
    [[Role.ADMIN, Role.ANALYST]],
  ])('habilidades de %j iguais ao catálogo', async (roles) => {
    const staff = await staffWithSession(t, ...roles);
    const res = await request(server()).get(ME).set('Cookie', staff.cookie).expect(200);
    expect((res.body as { abilities: string[] }).abilities).toEqual(abilitiesFor(roles));
  });

  it('Administrador recebe users.manage e não audit.read; Auditor o contrário', async () => {
    const admin = await staffWithSession(t, Role.ADMIN);
    const auditor = await staffWithSession(t, Role.AUDITOR);
    const a = (await request(server()).get(ME).set('Cookie', admin.cookie)).body as { abilities: string[] };
    const b = (await request(server()).get(ME).set('Cookie', auditor.cookie)).body as { abilities: string[] };
    expect(a.abilities).toContain('users.manage');
    expect(a.abilities).not.toContain('audit.read');
    expect(b.abilities).toContain('audit.read');
    expect(b.abilities).not.toContain('users.manage');
  });

  it('perfil retirado reflete na requisição seguinte', async () => {
    const staff = await staffWithSession(t, Role.COMPLIANCE_MANAGER, Role.DPO);
    await ds.query(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'COMPLIANCE_MANAGER'`, [staff.id]);
    const res = await request(server()).get(ME).set('Cookie', staff.cookie).expect(200);
    expect(res.body).toMatchObject({ roles: [Role.DPO], abilities: abilitiesFor([Role.DPO]) });
  });

  it('horários de expiração: inatividade nunca depois do real, até 1 min antes; absoluta = login + 8 h', async () => {
    const staff = await staffWithSession(t, Role.ANALYST);
    const [session] = (await ds.query(`SELECT created_at FROM sessions WHERE user_id = $1`, [staff.id])) as Array<{
      created_at: Date;
    }>;
    t.clock.advance(10 * MINUTE);
    const now = t.clock.now();
    const res = await request(server()).get(ME).set('Cookie', staff.cookie).expect(200);
    const body = res.body as { idleExpiresAt: string; absoluteExpiresAt: string };
    const idle = Date.parse(body.idleExpiresAt);
    expect(idle).toBeLessThanOrEqual(now + 15 * MINUTE);
    expect(idle).toBeGreaterThanOrEqual(now + 14 * MINUTE);
    expect(Date.parse(body.absoluteExpiresAt)).toBe(session.created_at.getTime() + 8 * 60 * MINUTE);

    // Uma consulta 30 s depois (sem regravar o último uso) não promete mais que o banco.
    t.clock.advance(30_000);
    const again = (await request(server()).get(ME).set('Cookie', staff.cookie).expect(200)).body as {
      idleExpiresAt: string;
    };
    const [row] = (await ds.query(`SELECT last_active_at FROM sessions WHERE user_id = $1`, [staff.id])) as Array<{
      last_active_at: Date;
    }>;
    expect(Date.parse(again.idleExpiresAt)).toBe(row.last_active_at.getTime() + 15 * MINUTE);
  });

  it('não grava nada na trilha', async () => {
    const staff = await staffWithSession(t, Role.ANALYST);
    await new Promise((r) => setTimeout(r, 200));
    const before = await auditCount();
    await request(server()).get(ME).set('Cookie', staff.cookie).expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(await auditCount()).toBe(before);
  });

  it('sem sessão ou com a pessoa desativada: 401', async () => {
    await request(server()).get(ME).expect(401);
    await request(server()).get(ME).set('Cookie', '__Host-sid=XQZ').expect(401);
    const staff = await staffWithSession(t, Role.DPO);
    await ds.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [staff.id]);
    await request(server()).get(ME).set('Cookie', staff.cookie).expect(401);
  });
});
