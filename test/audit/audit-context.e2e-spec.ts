import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuditResult } from '../../src/common/enums/audit-result.enum.js';
import { Role } from '../../src/common/enums/role.enum.js';
import { AuditAction, AuditResourceType } from '../../src/modules/audit/audit-action.enum.js';
import { AuditActorUndetermined } from '../../src/modules/audit/audit-context.js';
import { AuditService, type AuditEntry } from '../../src/modules/audit/audit.service.js';
import { testIdentity } from '../support/fake-identity.js';
import { AuditFixtureModule } from '../support/fixtures/audit-fixture.module.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** O ator vem do contexto e nunca do módulo (US2, FR-007 a FR-012, D46). */
describe('Contexto do ator da auditoria (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;

  beforeAll(async () => {
    t = await createTestApp({ imports: [AuditFixtureModule], identity: true });
    ds = t.app.get(DataSource);
  });

  afterAll(async () => {
    await t.close();
  });

  const row = async (id: string) =>
    (
      (await ds.query(`SELECT actor_type, actor_user_id, ip, user_agent FROM audit_logs WHERE id = $1`, [id])) as Array<
        Record<string, unknown>
      >
    )[0];

  it('rota pública grava REPORTER sem usuário, IP nem user-agent, mesmo com X-Forwarded-For', async () => {
    const res = await request(t.app.getHttpServer())
      .post('/api/public/v1/audit-fixtures/record')
      .set('X-Forwarded-For', '203.0.113.9')
      .set('X-Real-IP', '203.0.113.9')
      .set('User-Agent', 'Navegador XQZ')
      .expect(201);
    expect(await row(res.body.id)).toEqual({ actor_type: 'REPORTER', actor_user_id: null, ip: null, user_agent: null });
  });

  it('rota administrativa grava STAFF com o id, o IP real e o user-agent truncado em 255', async () => {
    const userId = randomUUID();
    const res = await request(t.app.getHttpServer())
      .post(`/api/admin/v1/audit-fixtures/record/${randomUUID()}`)
      .set(testIdentity(userId, Role.ANALYST))
      .set('X-Forwarded-For', '198.51.100.7')
      .set('User-Agent', 'U'.repeat(300))
      .expect(201);
    const saved = await row(res.body.id);
    expect(saved!.actor_type).toBe('STAFF');
    expect(saved!.actor_user_id).toBe(userId);
    expect(saved!.ip).toBe('198.51.100.7');
    expect(String(saved!.user_agent)).toHaveLength(255);
  });

  it('fora de requisição, job ou comando, o registro é recusado sem gravar nada', async () => {
    const before = ((await ds.query(`SELECT count(*)::int AS n FROM audit_logs`)) as Array<{ n: number }>)[0]!.n;
    const entry: AuditEntry = {
      action: AuditAction.REPORT_VIEWED,
      resourceType: AuditResourceType.REPORT,
      result: AuditResult.SUCCESS,
    };
    await expect(t.app.get(AuditService).record(entry)).rejects.toBeInstanceOf(AuditActorUndetermined);
    const after = ((await ds.query(`SELECT count(*)::int AS n FROM audit_logs`)) as Array<{ n: number }>)[0]!.n;
    expect(after).toBe(before);
  });

  it('a entrada não aceita ator, IP nem user-agent (FR-012)', () => {
    const entry: AuditEntry = {
      action: AuditAction.REPORT_VIEWED,
      resourceType: AuditResourceType.REPORT,
      result: AuditResult.SUCCESS,
      // @ts-expect-error: o ator vem só do contexto
      actorType: 'STAFF',
    };
    expect(entry).toBeDefined();
  });
});
