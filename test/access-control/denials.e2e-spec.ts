import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { UserStatus } from '../../src/common/enums/user-status.enum.js';
import { runAsSystem } from '../../src/modules/audit/audit-context.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { ExampleAuthModule } from '../contract/auth/example/example.module.js';
import { blockReport, createBareReport, createUser } from '../support/factories.js';
import { ReportAccessFixtureModule } from '../support/fixtures/report-access-fixture.module.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import { createUsersApp, staffWithSession, type StaffSession } from '../users/support.js';

interface DenialRow {
  result: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Negações sempre na trilha (US4, ACL-04, SC-005): cada 403 de rota administrativa (guard ou `authorize()`) e cada 404
 * de denúncia gera exatamente um `ACCESS_DENIED`, `result = DENIED`, com o código do catálogo e o tipo de recurso, e
 * só nomes de código e enums na metadata.
 */
describe('Negações na trilha (e2e)', () => {
  let t: TestApp & { clock: TestClock };
  let ds: DataSource;
  let analyst: StaffSession;
  let other: StaffSession;
  let dpo: StaffSession;

  const server = () => t.app.getHttpServer();
  const rows = async (actorId: string): Promise<DenialRow[]> =>
    (await ds.query(
      `SELECT result::text, resource_type::text, resource_id, metadata FROM audit_logs
        WHERE action = 'ACCESS_DENIED' AND actor_user_id = $1 ORDER BY id`,
      [actorId],
    )) as DenialRow[];

  /** Faz a chamada e devolve só as negações novas, esperando a escrita assíncrona do assinante assentar. */
  const deniedBy = async (actorId: string, call: () => Promise<unknown>): Promise<DenialRow[]> => {
    const before = (await rows(actorId)).length;
    await call();
    let found = await rows(actorId);
    for (const end = Date.now() + 3_000; found.length === before && Date.now() < end;) {
      await new Promise((r) => setTimeout(r, 50));
      found = await rows(actorId);
    }
    await new Promise((r) => setTimeout(r, 150)); // nada além de um registro deve chegar depois
    return (await rows(actorId)).slice(before);
  };

  beforeAll(async () => {
    t = await createUsersApp(undefined, { imports: [ReportAccessFixtureModule, ExampleAuthModule] });
    ds = t.app.get(DataSource);
    analyst = await staffWithSession(t, Role.ANALYST);
    other = await staffWithSession(t, Role.ANALYST);
    dpo = await staffWithSession(t, Role.DPO);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('403 do guard na rota de usuários: UsersPolicy, users.manage, user, sem id', async () => {
    const found = await deniedBy(analyst.id, () =>
      request(server()).get('/api/admin/v1/users').set('Cookie', analyst.cookie).expect(403),
    );
    expect(found).toEqual([
      {
        result: 'DENIED',
        resource_type: 'user',
        resource_id: null,
        metadata: { policy: 'UsersPolicy', ability: 'manage', code: 'users.manage' },
      },
    ]);
  });

  it('403 do guard na trilha: AuditPolicy, audit.read, audit_log', async () => {
    const found = await deniedBy(analyst.id, () =>
      request(server()).get('/api/admin/v1/audit-logs').set('Cookie', analyst.cookie).expect(403),
    );
    expect(found).toEqual([
      {
        result: 'DENIED',
        resource_type: 'audit_log',
        resource_id: null,
        metadata: { policy: 'AuditPolicy', ability: 'read', code: 'audit.read' },
      },
    ]);
  });

  it('403 do guard em rota de denúncia: ReportsPolicy, reports.treat, report', async () => {
    const { id } = await createBareReport(ds, { assignedToId: dpo.id });
    const found = await deniedBy(dpo.id, () =>
      request(server())
        .post(`/api/admin/v1/report-access-fixture/${id}/treatment`)
        .set('Cookie', dpo.cookie)
        .expect(403),
    );
    expect(found).toEqual([
      {
        result: 'DENIED',
        resource_type: 'report',
        resource_id: null,
        metadata: { policy: 'ReportsPolicy', ability: 'treatAny', code: 'reports.treat' },
      },
    ]);
  });

  it('rota sem declaração: 403 com SYSTEM e sem código', async () => {
    const found = await deniedBy(analyst.id, () =>
      request(server()).get('/api/admin/v1/example-admin/no-rule').set('Cookie', analyst.cookie).expect(403),
    );
    expect(found).toEqual([
      { result: 'DENIED', resource_type: 'system', resource_id: null, metadata: { policy: null, ability: null } },
    ]);
  });

  it('os dois 404 de denúncia: um registro cada, com motivo', async () => {
    const { id } = await createBareReport(ds, { assignedToId: other.id });
    const missing = randomUUID();
    const scope = await deniedBy(analyst.id, () =>
      request(server()).get(`/api/admin/v1/report-access-fixture/${id}`).set('Cookie', analyst.cookie).expect(404),
    );
    const notFound = await deniedBy(analyst.id, () =>
      request(server()).get(`/api/admin/v1/report-access-fixture/${missing}`).set('Cookie', analyst.cookie).expect(404),
    );
    expect(scope).toEqual([
      {
        result: 'DENIED',
        resource_type: 'report',
        resource_id: id,
        metadata: { code: 'reports.read', reason: 'OUT_OF_SCOPE' },
      },
    ]);
    expect(notFound).toEqual([
      {
        result: 'DENIED',
        resource_type: 'report',
        resource_id: missing,
        metadata: { code: 'reports.read', reason: 'NOT_FOUND' },
      },
    ]);
  });

  it('bloqueio por conflito do DPO: 404 com OUT_OF_SCOPE', async () => {
    const { id } = await createBareReport(ds);
    await blockReport(ds, id, dpo.id);
    const found = await deniedBy(dpo.id, () =>
      request(server()).get(`/api/admin/v1/report-access-fixture/${id}`).set('Cookie', dpo.cookie).expect(404),
    );
    expect(found.map((r) => r.metadata)).toEqual([{ code: 'reports.read', reason: 'OUT_OF_SCOPE' }]);
  });

  it('reconferência de quem age nos usuários (FR-011a da 005): required ADMIN e users.manage', async () => {
    // Identidade velha: a pessoa era ADMIN no início da requisição, mas já perdeu o perfil no banco.
    const stale = await createUser(ds, { roles: [Role.ANALYST] });
    const target = await createUser(ds, { roles: [Role.ANALYST] });
    const users = t.app.get(UsersService);
    const found = await deniedBy(stale.id, () =>
      runAsSystem(() =>
        users
          .changeStatus({ id: stale.id, roles: [Role.ADMIN], status: UserStatus.ACTIVE }, target.id, UserStatus.BLOCKED)
          .then(
            () => {
              throw new Error('deveria recusar');
            },
            (error: { status?: number }) => expect(error.status).toBe(403),
          ),
      ),
    );
    // Fora de requisição o ator é o sistema: confere pelo recurso.
    const [row] = (await ds.query(
      `SELECT result::text, resource_type::text, resource_id, metadata FROM audit_logs
        WHERE action = 'ACCESS_DENIED' AND resource_id = $1`,
      [target.id],
    )) as DenialRow[];
    expect(found).toEqual([]);
    expect(row).toEqual({
      result: 'DENIED',
      resource_type: 'user',
      resource_id: target.id,
      metadata: { required: 'ADMIN', code: 'users.manage' },
    });
  });
});
