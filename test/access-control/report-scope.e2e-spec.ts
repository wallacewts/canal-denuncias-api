import { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { UserStatus } from '../../src/common/enums/user-status.enum.js';
import { paginate } from '../../src/common/pagination/cursor.js';
import type { StaffUser } from '../../src/infra/auth/staff-user.js';
import { ReportsPolicy } from '../../src/modules/access-control/policies/reports.policy.js';
import { ReportAccessService } from '../../src/modules/access-control/report-access.service.js';
import { scopeReportsFor } from '../../src/modules/access-control/report-scope.js';
import { runAsSystem } from '../../src/modules/audit/audit-context.js';
import { Report } from '../../src/modules/reports/entities/report.entity.js';
import { blockReport, createBareReport, createCategory, createUser } from '../support/factories.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/**
 * Listagem filtrada na consulta (US3, ACL-03, D60, SC-002, SC-003): o cenário do ACL-03 com o conjunto esperado
 * escrito à mão, a prova exaustiva "listado ⇔ leitura permitida" e uma única consulta por listagem.
 */
describe('scopeReportsFor: escopo no WHERE (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;

  const staff = async (...roles: Role[]): Promise<StaffUser> => {
    const u = await createUser(ds, { roles });
    return { id: u.id, roles, status: UserStatus.ACTIVE };
  };

  /** Ids listados para a pessoa, só entre os informados (cada teste cria as suas denúncias). */
  const listed = async (user: StaffUser, among: string[]): Promise<string[]> => {
    const qb = scopeReportsFor(user, ds.getRepository(Report).createQueryBuilder('r')).andWhere('r.id = ANY(:among)', {
      among,
    });
    return (await qb.getMany()).map((r) => r.id).sort();
  };

  beforeAll(async () => {
    t = await createTestApp();
    ds = t.app.get(DataSource);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('cenário do ACL-03: 3 analistas, Gestora e DPO com bloqueio, 10 denúncias', async () => {
    const [a1, a2, a3] = [await staff(Role.ANALYST), await staff(Role.ANALYST), await staff(Role.ANALYST)];
    const manager = await staff(Role.COMPLIANCE_MANAGER);
    const dpo = await staff(Role.DPO);
    const admin = await staff(Role.ADMIN);
    const auditor = await staff(Role.AUDITOR);
    const category = await createCategory(ds);
    const owners = [a1, a1, a1, a2, a2, a3, null, null, a3, a1];
    const r: string[] = [];
    for (const owner of owners) {
      r.push((await createBareReport(ds, { assignedToId: owner?.id ?? null, categoryId: category.id })).id);
    }
    await blockReport(ds, r[3], manager.id); // Gestora impedida na r3 (de a2)
    await blockReport(ds, r[6], dpo.id); // DPO impedido na r6 (sem atribuição)
    await blockReport(ds, r[9], a1.id); // a1 impedido na própria r9

    const pick = (...indexes: number[]) => indexes.map((i) => r[i]).sort();
    expect(await listed(a1, r)).toEqual(pick(0, 1, 2));
    expect(await listed(a2, r)).toEqual(pick(3, 4));
    expect(await listed(a3, r)).toEqual(pick(5, 8));
    expect(await listed(manager, r)).toEqual(pick(0, 1, 2, 4, 5, 6, 7, 8, 9));
    expect(await listed(dpo, r)).toEqual(pick(0, 1, 2, 3, 4, 5, 7, 8, 9));
    expect(await listed(admin, r)).toEqual([]);
    expect(await listed(auditor, r)).toEqual([]);
  });

  it('prova exaustiva: para toda pessoa e denúncia, listada ⇔ ReportsPolicy.read sobre os fatos do resolve', async () => {
    const profiles: Role[][] = [
      [Role.COMPLIANCE_MANAGER],
      [Role.DPO],
      [Role.ANALYST],
      [Role.ANALYST],
      [Role.AUDITOR],
      [Role.ADMIN],
      [Role.ADMIN, Role.ANALYST],
      [Role.DPO, Role.ANALYST],
      [Role.COMPLIANCE_MANAGER, Role.DPO],
    ];
    const users: StaffUser[] = [];
    for (const roles of profiles) users.push(await staff(...roles));
    const category = await createCategory(ds);
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) {
      const assignee = next() < 0.2 ? null : users[Math.floor(next() * users.length)].id;
      const { id } = await createBareReport(ds, { assignedToId: assignee, categoryId: category.id });
      ids.push(id);
      for (const u of users) if (next() < 0.15) await blockReport(ds, id, u.id);
    }

    const access = t.app.get(ReportAccessService);
    const policy = new ReportsPolicy();
    for (const user of users) {
      const allowed: string[] = [];
      for (const id of ids) {
        // Os fatos vêm da mesma consulta do resolve (com a habilidade mais ampla, só para carregar sem negar).
        const facts = await runAsSystem(() =>
          access.resolve({ ...user, roles: [Role.COMPLIANCE_MANAGER] }, id, 'reports.read').catch(() => null),
        );
        const loaded = facts ?? {
          reportId: id,
          exists: true,
          assignedToId: null,
          blockedForUser: true,
          shreddedAt: null,
        };
        if (policy.read(user, loaded)) allowed.push(id);
      }
      expect(await listed(user, ids), user.roles.join('+')).toEqual(allowed.sort());
    }
  });

  it('uma única consulta por listagem, compatível com filtro extra e com paginate()', async () => {
    const analyst = await staff(Role.ANALYST);
    const category = await createCategory(ds);
    const mine: string[] = [];
    for (let i = 0; i < 3; i++) {
      mine.push((await createBareReport(ds, { assignedToId: analyst.id, categoryId: category.id })).id);
    }
    await createBareReport(ds, { assignedToId: null, categoryId: category.id });
    await blockReport(ds, mine[2], analyst.id);

    const runner = ds.createQueryRunner();
    try {
      const spy = vi.spyOn(runner, 'query');
      const qb = scopeReportsFor(analyst, ds.getRepository(Report).createQueryBuilder('r', runner)).andWhere(
        'r.categoryId = :categoryId',
        { categoryId: category.id },
      );
      const page = await paginate(qb, { limit: 1, after: undefined });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(page.items.map((r) => r.id)).toEqual([mine.sort()[0]]);
      expect(page.nextCursor).not.toBeNull();
      const [sql, params] = qb.getQueryAndParameters();
      expect(sql).toContain('report_access_blocks');
      expect(params).toContain(analyst.id);
    } finally {
      await runner.release();
    }
  });

  it('sem pessoa ou sem a habilidade de listar: conjunto vazio, nunca "todas"', async () => {
    const { id } = await createBareReport(ds);
    expect(await listed(await staff(Role.ADMIN), [id])).toEqual([]);
    const sql = scopeReportsFor(null, ds.getRepository(Report).createQueryBuilder('r')).getQuery();
    expect(sql).toMatch(/FALSE/i);
  });
});
