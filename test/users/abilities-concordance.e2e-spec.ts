import request from 'supertest';
import { Role } from '../../src/common/enums/role.enum.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import { createUsersApp, staffWithSession } from './support.js';

/**
 * US2 (T022, SC-005): o que o `/me` anuncia bate com o que o servidor permite nas rotas que já existem. O ACL-01
 * estende esta tabela às rotas de denúncias.
 */
describe('Concordância catálogo × servidor (e2e)', () => {
  let t: TestApp & { clock: TestClock };
  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createUsersApp();
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const ROUTES: Array<[string, string]> = [
    ['users.manage', '/api/admin/v1/users'],
    ['audit.read', '/api/admin/v1/audit-logs'],
  ];

  it.each([
    [[Role.ADMIN]],
    [[Role.COMPLIANCE_MANAGER]],
    [[Role.ANALYST]],
    [[Role.DPO]],
    [[Role.AUDITOR]],
    [[Role.ADMIN, Role.AUDITOR]],
  ])('%j: habilidade no /me ⇔ 200 na rota', async (roles) => {
    const staff = await staffWithSession(t, ...roles);
    const me = await request(server()).get('/api/admin/v1/me').set('Cookie', staff.cookie).expect(200);
    const abilities = (me.body as { abilities: string[] }).abilities;
    for (const [ability, path] of ROUTES) {
      const res = await request(server()).get(path).set('Cookie', staff.cookie);
      expect([ability, res.status]).toEqual([ability, abilities.includes(ability) ? 200 : 403]);
    }
  });
});
