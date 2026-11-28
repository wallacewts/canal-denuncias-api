import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { testIdentity } from '../support/fake-identity.js';
import { AuditFixtureModule } from '../support/fixtures/audit-fixture.module.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Rotas marcadas com @Audited registram o resultado sozinhas (US3, FR-013 a FR-016). */
describe('@Audited (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;
  const STAFF = testIdentity(randomUUID(), Role.COMPLIANCE_MANAGER);

  beforeAll(async () => {
    t = await createTestApp({ imports: [AuditFixtureModule], identity: true });
    ds = t.app.get(DataSource);
  });

  afterAll(async () => {
    await t.close();
  });

  const rowsFor = async (resourceId: string) =>
    (await ds.query(
      `SELECT action, result, resource_id, metadata, actor_type FROM audit_logs WHERE resource_id = $1 ORDER BY id`,
      [resourceId],
    )) as Array<Record<string, unknown>>;

  it('sucesso: exatamente um registro SUCCESS, com o id do recurso e sem a resposta', async () => {
    const id = randomUUID();
    await request(t.app.getHttpServer()).get(`/api/admin/v1/audit-fixtures/items/${id}`).set(STAFF).expect(200);
    const rows = await rowsFor(id);
    expect(rows).toEqual([
      { action: 'REPORT_VIEWED', result: 'SUCCESS', resource_id: id, metadata: null, actor_type: 'STAFF' },
    ]);
  });

  it('403: um registro DENIED', async () => {
    const id = randomUUID();
    await request(t.app.getHttpServer()).get(`/api/admin/v1/audit-fixtures/forbidden/${id}`).set(STAFF).expect(403);
    expect((await rowsFor(id)).map((r) => r.result)).toEqual(['DENIED']);
  });

  it('erro: um registro FAILURE, e a resposta segue o formato único sem dado da requisição', async () => {
    const id = randomUUID();
    const res = await request(t.app.getHttpServer())
      .get(`/api/admin/v1/audit-fixtures/broken/${id}`)
      .set(STAFF)
      .expect(500);
    expect(Object.keys(res.body).sort()).toEqual(['error', 'message', 'requestId', 'statusCode']);
    expect((await rowsFor(id)).map((r) => r.result)).toEqual(['FAILURE']);
  });

  it('o corpo da requisição nunca vai para a trilha', async () => {
    const id = randomUUID();
    await request(t.app.getHttpServer())
      .post(`/api/admin/v1/audit-fixtures/notes/${id}`)
      .set(STAFF)
      .send({ texto: 'XQZ' })
      .expect(201);
    const rows = await rowsFor(id);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('XQZ');
  });

  it('se a gravação de um sucesso falha, a rota responde 500 genérico em vez de entregar o resultado (FR-015)', async () => {
    const before = ((await ds.query(`SELECT count(*)::int AS n FROM audit_logs`)) as Array<{ n: number }>)[0]!.n;
    const res = await request(t.app.getHttpServer())
      .get('/api/admin/v1/audit-fixtures/unrecordable')
      .set(STAFF)
      .expect(500);
    expect(JSON.stringify(res.body)).not.toContain('XQZ');
    const after = ((await ds.query(`SELECT count(*)::int AS n FROM audit_logs`)) as Array<{ n: number }>)[0]!.n;
    expect(after).toBe(before);
  });
});
