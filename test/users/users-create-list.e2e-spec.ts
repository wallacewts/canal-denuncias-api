import { PasswordHasher } from '@nestjs/authentication';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { UserStatus } from '../../src/common/enums/user-status.enum.js';
import { createUser } from '../support/factories.js';
import type { TestApp } from '../support/test-app.js';
import type { TestClock } from '../support/auth-clock.js';
import { createUsersApp, staffWithSession, type StaffSession } from './support.js';

const BASE = '/api/admin/v1/users';
const STAFF_KEYS = [
  'createdAt',
  'email',
  'id',
  'lastLoginAt',
  'mfaEnabled',
  'name',
  'passwordChangeRequired',
  'roles',
  'status',
  'updatedAt',
];

/** US1 (T014): cadastrar e consultar a equipe; senha provisória uma vez; nada sensível nas respostas e na trilha. */
describe('Equipe: cadastro e consulta (e2e)', () => {
  let t: TestApp & { clock: TestClock };
  let ds: DataSource;
  let admin: StaffSession;
  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createUsersApp();
    ds = t.app.get<DataSource>(getDataSourceToken());
    admin = await staffWithSession(t, Role.ADMIN);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const create = (body: object, cookie = admin.cookie) => request(server()).post(BASE).set('Cookie', cookie).send(body);

  it('cadastra ativa, sem MFA, com troca obrigatória e a senha provisória uma única vez', async () => {
    const res = await create({ name: 'Ana', email: 'ana.xqz@empresa.test', roles: [Role.ANALYST] }).expect(201);
    const { user, temporaryPassword } = res.body as { user: Record<string, unknown>; temporaryPassword: string };
    expect(Object.keys(res.body as object).sort()).toEqual(['temporaryPassword', 'user']);
    expect(Object.keys(user).sort()).toEqual(STAFF_KEYS);
    expect(user).toMatchObject({
      name: 'Ana',
      email: 'ana.xqz@empresa.test',
      roles: [Role.ANALYST],
      status: UserStatus.ACTIVE,
      mfaEnabled: false,
      passwordChangeRequired: true,
      lastLoginAt: null,
    });
    expect(temporaryPassword).toHaveLength(20);

    const [row] = (await ds.query(`SELECT password_hash FROM users WHERE id = $1`, [user.id])) as Array<{
      password_hash: string;
    }>;
    expect(await t.app.get(PasswordHasher).verify(temporaryPassword, row.password_hash)).toBe(true);

    const detail = await request(server())
      .get(`${BASE}/${String(user.id)}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(Object.keys(detail.body as object).sort()).toEqual(STAFF_KEYS);
    const listed = await request(server()).get(BASE).set('Cookie', admin.cookie).expect(200);
    for (const body of [detail.text, listed.text]) {
      expect(body).not.toContain(temporaryPassword);
      expect(body).not.toContain('$scrypt$');
      expect(body).not.toMatch(/password_hash|passwordHash|mfaSecret|recovery/i);
    }

    const [log] = (await ds.query(
      `SELECT actor_type::text, actor_user_id::text, metadata, result::text FROM audit_logs
        WHERE action = 'USER_CREATED' AND resource_id = $1`,
      [user.id],
    )) as Array<Record<string, unknown>>;
    expect(log).toEqual({
      actor_type: 'STAFF',
      actor_user_id: admin.id,
      metadata: { roles: [Role.ANALYST] },
      result: 'SUCCESS',
    });

    const trail = JSON.stringify(await ds.query(`SELECT * FROM audit_logs`));
    const logs = t.logs.text();
    for (const text of [trail, logs]) {
      expect(text).not.toContain(temporaryPassword);
      expect(text).not.toContain(temporaryPassword.slice(0, 8));
      expect(text).not.toContain('ana.xqz@empresa.test');
      expect(text).not.toContain('temporaryPassword');
    }
  });

  it('e-mail repetido com outra caixa e espaços: 409 com código, sem senha nem e-mail na resposta', async () => {
    await create({ name: 'Bia', email: 'bia@empresa.test', roles: [Role.DPO] }).expect(201);
    const res = await create({ name: 'Outra', email: '  BIA@Empresa.TEST ', roles: [Role.DPO] }).expect(409);
    expect(res.body).toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
    expect(res.text).not.toContain('temporaryPassword');
    expect(res.text.toLowerCase()).not.toContain('bia@empresa.test');
    const rows = (await ds.query(`SELECT count(*)::int AS n FROM users WHERE email = 'bia@empresa.test'`)) as Array<{
      n: number;
    }>;
    expect(rows[0].n).toBe(1);
    expect(t.logs.text().toLowerCase()).not.toContain('bia@empresa.test');
  });

  it.each([
    ['campo extra', { name: 'X', email: 'x1@empresa.test', roles: [Role.DPO], status: 'BLOCKED' }],
    ['sem perfil', { name: 'X', email: 'x2@empresa.test', roles: [] }],
    ['e-mail inválido', { name: 'X', email: 'XQZ', roles: [Role.DPO] }],
  ])('%s: 400 sem ecoar valor', async (_caso, body) => {
    const res = await create(body).expect(400);
    expect(res.text).not.toContain('XQZ');
  });

  it('lista com filtro de status e perfil, em páginas de 10 por cursor', async () => {
    for (let i = 0; i < 30; i++) {
      const u = await createUser(ds, { roles: i % 2 === 0 ? [Role.DPO] : [Role.ANALYST] });
      if (i % 3 === 0) await ds.query(`UPDATE users SET status = 'BLOCKED' WHERE id = $1`, [u.id]);
    }
    const expected = (
      (await ds.query(
        `SELECT u.id::text AS id FROM users u JOIN user_roles r ON r.user_id = u.id
          WHERE u.status = 'BLOCKED' AND r.role = 'DPO' ORDER BY u.id`,
      )) as Array<{ id: string }>
    ).map((r) => r.id);
    expect(expected.length).toBeGreaterThan(0);

    const all = ((await ds.query(`SELECT id::text AS id FROM users ORDER BY id`)) as Array<{ id: string }>).map(
      (r) => r.id,
    );
    const seen: string[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      const res = await request(server())
        .get(BASE)
        .query({ limit: 10, ...(after && { after }) })
        .set('Cookie', admin.cookie)
        .expect(200);
      const page = res.body as { items: Array<{ id: string }>; nextCursor: string | null };
      expect(page.items.length).toBeLessThanOrEqual(10);
      seen.push(...page.items.map((i) => i.id));
      after = page.nextCursor;
      pages++;
    } while (after && pages < 20);
    expect(seen).toEqual(all);

    const filtered = await request(server())
      .get(BASE)
      .query({ status: 'BLOCKED', role: 'DPO', limit: 100 })
      .set('Cookie', admin.cookie)
      .expect(200);
    expect((filtered.body as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual(expected);
  });

  it('cursor adulterado: 400', async () => {
    await request(server()).get(BASE).query({ after: 'XQZ' }).set('Cookie', admin.cookie).expect(400);
  });

  it.each([Role.ANALYST, Role.DPO, Role.AUDITOR, Role.COMPLIANCE_MANAGER])(
    '%s recebe 403 e a negação vai para a trilha',
    async (role) => {
      const other = await staffWithSession(t, role);
      await request(server()).get(BASE).set('Cookie', other.cookie).expect(403);
      await create(
        { name: 'Y', email: `y.${role.toLowerCase()}@empresa.test`, roles: [Role.DPO] },
        other.cookie,
      ).expect(403);
      const deadline = Date.now() + 3_000;
      let rows: Array<{ metadata: unknown }> = [];
      while (rows.length < 2 && Date.now() < deadline) {
        rows = (await ds.query(
          `SELECT metadata, resource_type, resource_id FROM audit_logs WHERE action = 'ACCESS_DENIED' AND actor_user_id = $1`,
          [other.id],
        )) as Array<{ metadata: unknown }>;
        if (rows.length < 2) await new Promise((r) => setTimeout(r, 50));
      }
      // Código do catálogo e tipo de recurso da política (D61); nenhum id de registro vindo da rota.
      const denied = { policy: 'UsersPolicy', ability: 'manage', code: 'users.manage' };
      expect(rows).toEqual([
        { metadata: denied, resource_type: 'user', resource_id: null },
        { metadata: denied, resource_type: 'user', resource_id: null },
      ]);
    },
  );

  it('sem sessão: 401; id inexistente: 404; id malformado: 400', async () => {
    await request(server()).get(BASE).expect(401);
    await request(server())
      .post(BASE)
      .send({ name: 'Z', email: 'z@empresa.test', roles: [Role.DPO] })
      .expect(401);
    await request(server()).get(`${BASE}/01900000-0000-7000-8000-00000000dead`).set('Cookie', admin.cookie).expect(404);
    await request(server()).get(`${BASE}/XQZ`).set('Cookie', admin.cookie).expect(400);
  });
});
