import type { Role } from '../../src/common/enums/role.enum.js';
import { AUTH_CLOCK } from '../../src/infra/auth/auth-clock.js';
import { createStaff, signInFully, type Staff } from '../contract/auth/example/auth-helpers.js';
import { ExampleAuthModule } from '../contract/auth/example/example.module.js';
import { TestClock } from '../support/auth-clock.js';
import { createTestApp, type CreateTestAppOptions, type TestApp } from '../support/test-app.js';

/**
 * Apoio dos e2e da feature 005: app com o login de exemplo da feature 004 (só de teste) e relógio controlado. As
 * rotas de equipe exigem a sessão real (política sobre `request.user`), então nada de identidade simulada.
 */
export async function createUsersApp(
  clock = new TestClock(),
  extra: Pick<CreateTestAppOptions, 'imports' | 'overrides'> = {},
): Promise<TestApp & { clock: TestClock }> {
  const t = await createTestApp({
    vault: 'api',
    imports: [ExampleAuthModule, ...(extra.imports ?? [])],
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
