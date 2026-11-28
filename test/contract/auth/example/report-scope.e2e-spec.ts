import { AuthorizationService } from '@nestjs/authorization';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Role } from '../../../../src/common/enums/role.enum.js';
import { UserStatus } from '../../../../src/common/enums/user-status.enum.js';
import type { StaffUser } from '../../../../src/infra/auth/staff-user.js';
import { createCategory, createUser } from '../../../support/factories.js';
import { createTestApp, type TestApp } from '../../../support/test-app.js';
import { ExamplePolicy } from './example.policy.js';
import { ExampleReportRepository } from './example.repository.js';
import { ExampleAuthModule } from './example.module.js';

/**
 * Concordância política × consulta (US3, T025, FR-018, R6): para combinações geradas de perfis, atribuições e
 * bloqueios, o conjunto listado pela consulta filtrada é exatamente o conjunto em que a política permite leitura.
 */
describe('Função de escopo: a consulta e a política concordam (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;

  beforeAll(async () => {
    t = await createTestApp({ imports: [ExampleAuthModule] });
    ds = t.app.get<DataSource>(getDataSourceToken());
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('para cada usuário, listagem = denúncias em que a política permite ler', async () => {
    const profiles: Role[][] = [
      [Role.COMPLIANCE_MANAGER],
      [Role.DPO],
      [Role.ANALYST],
      [Role.ANALYST],
      [Role.AUDITOR],
      [Role.ADMIN, Role.ANALYST],
    ];
    const users: StaffUser[] = [];
    for (const roles of profiles) {
      const u = await createUser(ds, { roles });
      users.push({ id: u.id, roles, status: UserStatus.ACTIVE });
    }
    const category = await createCategory(ds);
    // Combinações determinísticas: cada denúncia atribuída a alguém (ou ninguém) e bloqueada para um subconjunto.
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 40; i++) {
      const assignee = next() < 0.2 ? null : users[Math.floor(next() * users.length)].id;
      const rows = (await ds.query(
        `INSERT INTO reports (protocol, access_key_hash, reporter_type, category_id, assigned_to_id)
         VALUES ('DV-' || substr(md5(random()::text), 1, 10), 'x', 'EMPLOYEE', $1, $2) RETURNING id`,
        [category.id, assignee],
      )) as Array<{ id: string }>;
      for (const u of users) {
        if (next() < 0.15) {
          await ds.query(`INSERT INTO report_access_blocks (report_id, user_id, created_by_id) VALUES ($1, $2, $2)`, [
            rows[0].id,
            u.id,
          ]);
        }
      }
    }

    const repo = t.app.get(ExampleReportRepository);
    const authz = t.app.get(AuthorizationService);
    const all = ((await ds.query(`SELECT id FROM reports ORDER BY id`)) as Array<{ id: string }>).map((r) => r.id);
    for (const user of users) {
      const listed = await repo.findVisibleTo(user);
      const allowed: string[] = [];
      for (const id of all) {
        const report = await repo.findForCheck(id);
        if (report && (await authz.can(ExamplePolicy, 'read', user, report))) allowed.push(id);
      }
      expect(listed.sort()).toEqual(allowed.sort());
    }
  });
});
