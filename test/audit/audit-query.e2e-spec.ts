import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuditResult } from '../../src/common/enums/audit-result.enum.js';
import { Role } from '../../src/common/enums/role.enum.js';
import { AuditAction, AuditResourceType } from '../../src/modules/audit/audit-action.enum.js';
import { runAsSystem } from '../../src/modules/audit/audit-context.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { testIdentity } from '../support/fake-identity.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Consulta da trilha pelo Auditor (US5, FR-018 a FR-022). */
describe('GET /api/admin/v1/audit-logs (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;
  const auditorId = randomUUID();
  const AUDITOR = testIdentity(auditorId, Role.AUDITOR);
  const analystId = randomUUID();
  const ANALYST = testIdentity(analystId, Role.ANALYST);
  const reportA = randomUUID();
  const reportB = randomUUID();

  beforeAll(async () => {
    t = await createTestApp({ identity: true });
    ds = t.app.get(DataSource);
    const audit = t.app.get(AuditService);
    await runAsSystem(async () => {
      for (const [resourceId, action] of [
        [reportA, AuditAction.REPORT_VIEWED],
        [reportB, AuditAction.REPORT_VIEWED],
        [reportA, AuditAction.REPORT_SHREDDED],
      ] as const) {
        await audit.record({ action, resourceType: AuditResourceType.REPORT, resourceId, result: AuditResult.SUCCESS });
      }
    });
  });

  afterAll(async () => {
    await t.close();
  });

  const get = (query: Record<string, string>, headers = AUDITOR) =>
    request(t.app.getHttpServer()).get('/api/admin/v1/audit-logs').query(query).set(headers);

  it('o Auditor recebe páginas em ordem decrescente com cursor para a próxima', async () => {
    const first = await get({ limit: '2' }).expect(200);
    expect(first.body.items).toHaveLength(2);
    const ids = first.body.items.map((i: { id: string }) => BigInt(i.id));
    expect(ids[0] > ids[1]).toBe(true);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await get({ limit: '2', after: first.body.nextCursor }).expect(200);
    expect(BigInt(second.body.items[0].id) < ids[1]).toBe(true);
    expect(first.headers['cache-control']).toBe('no-store');
  });

  it('cada filtro restringe o resultado', async () => {
    const byResource = await get({ resourceType: 'report', resourceId: reportA }).expect(200);
    expect(byResource.body.items).toHaveLength(2);
    const byAction = await get({ action: 'REPORT_SHREDDED' }).expect(200);
    expect(byAction.body.items.map((i: { resourceId: string }) => i.resourceId)).toEqual([reportA]);
    const future = await get({ from: '2999-01-01T00:00:00.000Z' }).expect(200);
    expect(future.body.items).toEqual([]);
    const actor = await get({ actorUserId: randomUUID() }).expect(200);
    expect(actor.body.items).toEqual([]);
  });

  it('a consulta grava AUDIT_LOG_VIEWED com os filtros, só identificadores e códigos', async () => {
    await get({ action: 'REPORT_VIEWED', resourceId: reportB }).expect(200);
    const [row] = (await ds.query(
      `SELECT actor_type, actor_user_id, metadata FROM audit_logs WHERE action = 'AUDIT_LOG_VIEWED' ORDER BY id DESC LIMIT 1`,
    )) as Array<Record<string, unknown>>;
    expect(row!.actor_type).toBe('STAFF');
    expect(row!.actor_user_id).toBe(auditorId);
    expect(row!.metadata).toEqual({ filters: { action: 'REPORT_VIEWED', resourceId: reportB }, count: 1 });
  });

  it('outro perfil recebe 403 e a tentativa fica registrada como ACCESS_DENIED', async () => {
    await get({}, ANALYST).expect(403);
    // A negação passa a vir da declaração da rota (`AuditPolicy`, feature 007), gravada pelo assinante (assíncrona).
    const row = await lastDenial(ds, analystId);
    expect(row).toEqual({
      result: 'DENIED',
      resource_type: 'audit_log',
      metadata: { policy: 'AuditPolicy', ability: 'read', code: 'audit.read' },
    });
  });

  it('sem identidade, 401', async () => {
    await request(t.app.getHttpServer()).get('/api/admin/v1/audit-logs').expect(401);
  });

  it.each([
    ['ação fora do catálogo', { action: 'XQZ' }],
    ['tipo fora do catálogo', { resourceType: 'XQZ' }],
    ['período invertido', { from: '2026-11-28T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' }],
    ['limite fora da faixa', { limit: '1000' }],
    ['cursor adulterado', { after: 'XQZ' }],
    ['campo desconhecido', { XQZ: '1' }],
  ])('%s: 400 com mensagem fixa, sem ecoar o valor', async (_caso, query) => {
    const res = await get(query as Record<string, string>).expect(400);
    expect(JSON.stringify(res.body)).not.toContain('XQZ');
  });
});

async function lastDenial(ds: DataSource, actorId: string): Promise<Record<string, unknown> | undefined> {
  for (const end = Date.now() + 3_000; ;) {
    const [row] = (await ds.query(
      `SELECT result::text, resource_type::text, metadata FROM audit_logs
        WHERE action = 'ACCESS_DENIED' AND actor_user_id = $1 ORDER BY id DESC LIMIT 1`,
      [actorId],
    )) as Array<Record<string, unknown>>;
    if (row || Date.now() > end) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
}
