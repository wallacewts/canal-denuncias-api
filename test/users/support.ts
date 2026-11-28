import type { Role } from '../../src/common/enums/role.enum.js';
import { AUTH_CLOCK } from '../../src/infra/auth/auth-clock.js';
import { createStaff, signInFully, type Staff } from '../contract/auth/example/auth-helpers.js';
import { TestClock } from '../support/auth-clock.js';
import { createTestApp, type CreateTestAppOptions, type TestApp } from '../support/test-app.js';

/**
 * Apoio dos e2e da feature 005: app com relógio controlado; as sessões vêm do login definitivo (feature 006). As
 * rotas de equipe exigem a sessão real (política sobre `request.user`), então nada de identidade simulada.
 */
export async function createUsersApp(
  clock = new TestClock(),
  extra: Pick<CreateTestAppOptions, 'imports' | 'overrides'> = {},
): Promise<TestApp & { clock: TestClock }> {
  const t = await createTestApp({
    vault: 'api',
    imports: extra.imports,
    overrides: [{ provide: AUTH_CLOCK, useValue: clock }, ...(extra.overrides ?? [])],
  });
  return Object.assign(t, { clock });
}

export type StaffSession = Staff & { cookie: string };

/** Cria uma pessoa da equipe com os perfis e devolve o cookie de uma sessão com MFA verificado. */
export async function staffWithSession(t: TestApp & { clock: TestClock }, ...roles: Role[]): Promise<StaffSession> {
  const staff = await createStaff(t.app, roles, { nowMs: t.clock.now() });
  t.clock.advance(30_000); // o passo TOTP da confirmação não vale de novo
  const cookie = await signInFully(t.app, staff, t.clock.now());
  return { ...staff, cookie };
}

/** Denúncia mínima só para a contagem de atribuídas (o módulo de denúncias ainda não existe). */
export async function insertReport(
  ds: import('typeorm').DataSource,
  assignedTo: string | null,
  status = 'RECEIVED',
): Promise<string> {
  const { createCategory } = await import('../support/factories.js');
  const category = await createCategory(ds);
  const rows = (await ds.query(
    `INSERT INTO reports (protocol, access_key_hash, reporter_type, category_id, assigned_to_id, status)
     VALUES ('DV-' || substr(md5(random()::text), 1, 10), 'x', 'EMPLOYEE', $1, $2, $3) RETURNING id`,
    [category.id, assignedTo, status],
  )) as Array<{ id: string }>;
  return rows[0].id;
}

/** Deixa só os Administradores indicados ativos (os demais são desativados direto no banco). */
export async function onlyActiveAdmins(ds: import('typeorm').DataSource, ...ids: string[]): Promise<void> {
  await ds.query(
    `UPDATE users SET status = 'DISABLED'
      WHERE id IN (SELECT user_id FROM user_roles WHERE role = 'ADMIN') AND NOT (id = ANY($1::uuid[]))`,
    [ids],
  );
}

export async function activeAdmins(ds: import('typeorm').DataSource): Promise<string[]> {
  const rows = (await ds.query(
    `SELECT u.id::text AS id FROM users u JOIN user_roles r ON r.user_id = u.id
      WHERE r.role = 'ADMIN' AND u.status = 'ACTIVE' ORDER BY u.id`,
  )) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}
