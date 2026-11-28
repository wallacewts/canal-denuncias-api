import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuditResult } from '../../src/common/enums/audit-result.enum.js';
import { Role } from '../../src/common/enums/role.enum.js';
import { AuditAction, AuditResourceType } from '../../src/modules/audit/audit-action.enum.js';
import { runAsSystem } from '../../src/modules/audit/audit-context.js';
import { AuditVerifierService } from '../../src/modules/audit/audit-verifier.service.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { withRole } from '../support/db-roles.js';
import { testIdentity } from '../support/fake-identity.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Verificação da cadeia por rota e por serviço (US6, FR-023 a FR-027). Os testes de adulteração vêm por último. */
describe('Verificação de integridade da trilha (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;
  let audit: AuditService;
  let verifier: AuditVerifierService;
  const AUDITOR = testIdentity(randomUUID(), Role.AUDITOR);

  const add = (n: number) =>
    runAsSystem(async () => {
      for (let i = 0; i < n; i++) {
        await audit.record({
          action: AuditAction.REPORT_VIEWED,
          resourceType: AuditResourceType.REPORT,
          resourceId: randomUUID(),
          result: AuditResult.SUCCESS,
        });
      }
    });

  const ids = async () =>
    ((await ds.query(`SELECT id FROM audit_logs ORDER BY id`)) as Array<{ id: string }>).map((r) => String(r.id));

  beforeAll(async () => {
    t = await createTestApp({ identity: true });
    ds = t.app.get(DataSource);
    audit = t.app.get(AuditService);
    verifier = t.app.get(AuditVerifierService);
    await add(25);
  });

  afterAll(async () => {
    await t.close();
  });

  it('o Auditor verifica uma trilha íntegra, e a verificação fica registrada', async () => {
    const res = await request(t.app.getHttpServer())
      .post('/api/admin/v1/audit-logs/verification')
      .set(AUDITOR)
      .expect(200);
    expect(res.body).toEqual({ ok: true, checked: expect.any(Number), firstBrokenId: null, anchoredAt: null });
    expect(res.body.checked).toBeGreaterThanOrEqual(25);
    const [row] = (await ds.query(
      `SELECT actor_type, metadata FROM audit_logs WHERE action = 'AUDIT_CHAIN_VERIFIED' ORDER BY id DESC LIMIT 1`,
    )) as Array<Record<string, unknown>>;
    expect(row).toEqual({
      actor_type: 'STAFF',
      metadata: { ok: true, checked: res.body.checked, anchored: false },
    });
  });

  it('outro perfil recebe 403 com ACCESS_DENIED; sem identidade, 401', async () => {
    await request(t.app.getHttpServer())
      .post('/api/admin/v1/audit-logs/verification')
      .set(testIdentity(randomUUID(), Role.DPO))
      .expect(403);
    const [row] = (await ds.query(
      `SELECT result FROM audit_logs WHERE action = 'ACCESS_DENIED' ORDER BY id DESC LIMIT 1`,
    )) as Array<Record<string, unknown>>;
    expect(row).toEqual({ result: 'DENIED' });
    await request(t.app.getHttpServer()).post('/api/admin/v1/audit-logs/verification').expect(401);
  });

  it('registros gravados durante a verificação não causam quebra (ponto de corte)', async () => {
    const result = await verifier.verify({ batchSize: 5, afterCutoff: () => add(3) });
    expect(result.ok).toBe(true);
  });

  it('em lotes pequenos, o resultado é o mesmo', async () => {
    const all = await verifier.verify({ batchSize: 1000 });
    const small = await verifier.verify({ batchSize: 2 });
    expect(small).toEqual(all);
  });

  it('registro alterado diretamente no banco (gatilho desligado só no teste): quebra no registro certo', async () => {
    const target = (await ids())[10]!;
    await withRole(t.database, 'superuser', async (c) => {
      await c.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable');
      await c.query(`UPDATE audit_logs SET resource_id = 'XQZ' WHERE id = $1`, [target]);
      await c.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable');
    });
    const result = await verifier.verify();
    expect(result).toEqual(expect.objectContaining({ ok: false, firstBrokenId: target }));
  });

  it('registro removido do meio: quebra no seguinte', async () => {
    const all = await ids();
    const removed = all[3]!;
    await withRole(t.database, 'superuser', async (c) => {
      await c.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable');
      await c.query(`DELETE FROM audit_logs WHERE id = $1`, [removed]);
      await c.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable');
    });
    const result = await verifier.verify();
    expect(result).toEqual(expect.objectContaining({ ok: false, firstBrokenId: all[4] }));
  });
});
