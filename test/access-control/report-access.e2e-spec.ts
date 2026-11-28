import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { withoutRequestId } from '../auth/support.js';
import { blockReport, createBareReport } from '../support/factories.js';
import { ReportAccessFixtureModule } from '../support/fixtures/report-access-fixture.module.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import { createUsersApp, staffWithSession, type StaffSession } from '../users/support.js';

const BASE = '/api/admin/v1/report-access-fixture';
const SHORT = 'XQZ';

interface DenialRow {
  result: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Denúncia por id (US2, ACL-02, ACL-04, D59, D62): a habilidade na rota (403 sem ela), o escopo no `resolve` (404
 * idêntico para fora do escopo e inexistente, ambos auditados com motivo), 410 só dentro do escopo, e a operação por
 * `authorize()` (403 para quem alcança mas não pode).
 */
describe('Acesso a uma denúncia por id (e2e)', () => {
  let t: TestApp & { clock: TestClock };
  let ds: DataSource;
  let manager: StaffSession;
  let dpo: StaffSession;
  let analystA: StaffSession;
  let analystB: StaffSession;
  let admin: StaffSession;
  let auditor: StaffSession;
  let dpoAnalyst: StaffSession;

  const get = (who: StaffSession, id: string) =>
    request(t.app.getHttpServer()).get(`${BASE}/${id}`).set('Cookie', who.cookie);
  const treat = (who: StaffSession, id: string) =>
    request(t.app.getHttpServer()).post(`${BASE}/${id}/treatment`).set('Cookie', who.cookie).send({});
  const decide = (who: StaffSession, id: string, requestId: string) =>
    request(t.app.getHttpServer())
      .post(`${BASE}/${id}/reveal-requests/${requestId}/decision`)
      .set('Cookie', who.cookie)
      .send({});

  const denials = async (actorId: string): Promise<DenialRow[]> =>
    (await ds.query(
      `SELECT result::text, resource_type::text, resource_id, metadata FROM audit_logs
        WHERE action = 'ACCESS_DENIED' AND actor_user_id = $1 ORDER BY id`,
      [actorId],
    )) as DenialRow[];

  /** Espera a quantidade de negações (as do guard são gravadas de forma assíncrona pelo assinante). */
  const waitDenials = async (actorId: string, count: number): Promise<DenialRow[]> => {
    for (const end = Date.now() + 3_000; ;) {
      const rows = await denials(actorId);
      if (rows.length >= count || Date.now() > end) return rows;
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  beforeAll(async () => {
    t = await createUsersApp(undefined, { imports: [ReportAccessFixtureModule] });
    ds = t.app.get(DataSource);
    manager = await staffWithSession(t, Role.COMPLIANCE_MANAGER);
    dpo = await staffWithSession(t, Role.DPO);
    analystA = await staffWithSession(t, Role.ANALYST);
    analystB = await staffWithSession(t, Role.ANALYST);
    admin = await staffWithSession(t, Role.ADMIN);
    auditor = await staffWithSession(t, Role.AUDITOR);
    dpoAnalyst = await staffWithSession(t, Role.DPO, Role.ANALYST);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('analista atribuído lê; Gestora e DPO leem qualquer uma', async () => {
    const { id } = await createBareReport(ds, { assignedToId: analystA.id });
    for (const who of [analystA, manager, dpo]) expect((await get(who, id).expect(200)).body).toEqual({ id });
  });

  it('fora do escopo e inexistente: mesmo 404 (código e corpo) e um ACCESS_DENIED cada, com motivo', async () => {
    const { id } = await createBareReport(ds, { assignedToId: analystA.id });
    const missing = randomUUID();
    const before = (await denials(analystB.id)).length;
    const outOfScope = await get(analystB, id).expect(404);
    const notFound = await get(analystB, missing).expect(404);
    expect(withoutRequestId(outOfScope.body)).toEqual(withoutRequestId(notFound.body));
    expect(JSON.stringify(outOfScope.body)).not.toContain(id);
    const rows = (await denials(analystB.id)).slice(before);
    expect(rows).toEqual([
      {
        result: 'DENIED',
        resource_type: 'report',
        resource_id: id,
        metadata: { code: 'reports.read', reason: 'OUT_OF_SCOPE' },
      },
      {
        result: 'DENIED',
        resource_type: 'report',
        resource_id: missing,
        metadata: { code: 'reports.read', reason: 'NOT_FOUND' },
      },
    ]);
  });

  it('bloqueio por conflito: Gestora, DPO e o próprio atribuído recebem 404', async () => {
    const { id } = await createBareReport(ds, { assignedToId: analystA.id });
    for (const who of [manager, dpo, analystA]) await blockReport(ds, id, who.id);
    for (const who of [manager, dpo, analystA]) await get(who, id).expect(404);
    const [last] = (await denials(manager.id)).slice(-1);
    expect(last.metadata).toEqual({ code: 'reports.read', reason: 'OUT_OF_SCOPE' });
  });

  it('expurgada: 410 REPORT_SHREDDED dentro do escopo, 404 fora dele (D59)', async () => {
    const { id } = await createBareReport(ds, { assignedToId: analystA.id, shreddedAt: new Date() });
    const gone = await get(analystA, id).expect(410);
    expect(gone.body).toMatchObject({ code: 'REPORT_SHREDDED' });
    await get(manager, id).expect(410);
    const hidden = await get(analystB, id).expect(404);
    const missing = await get(analystB, randomUUID()).expect(404);
    expect(withoutRequestId(hidden.body)).toEqual(withoutRequestId(missing.body));
  });

  it('sem nenhuma habilidade de leitura (ADMIN, AUDITOR): 403 na rota, sem consultar a denúncia', async () => {
    const { id } = await createBareReport(ds, { assignedToId: analystA.id });
    for (const who of [admin, auditor]) {
      await get(who, id).expect(403);
      const rows = await waitDenials(who.id, 1);
      expect(rows.at(-1)).toEqual({
        result: 'DENIED',
        resource_type: 'report',
        resource_id: null,
        metadata: { policy: 'ReportsPolicy', ability: 'readAny', code: 'reports.read' },
      });
    }
  });

  it('tratar: DPO 403 na rota; analista com a de outro 404; atribuído e Gestora tratam', async () => {
    const { id } = await createBareReport(ds, { assignedToId: analystA.id });
    await treat(dpo, id).expect(403);
    await treat(analystB, id).expect(404);
    await treat(analystA, id).expect(200);
    await treat(manager, id).expect(200);
  });

  it('DPO + Analista lê qualquer uma, mas só trata a sua: 403 do authorize() com ACCESS_DENIED', async () => {
    const { id } = await createBareReport(ds, { assignedToId: analystA.id });
    await get(dpoAnalyst, id).expect(200);
    await treat(dpoAnalyst, id).expect(403);
    const rows = await waitDenials(dpoAnalyst.id, 1);
    expect(rows.at(-1)?.metadata).toEqual({ policy: 'ReportsPolicy', ability: 'treat', code: 'reports.treat' });
  });

  it('reatribuição vale na requisição seguinte', async () => {
    const { id } = await createBareReport(ds, { assignedToId: analystA.id });
    await get(analystA, id).expect(200);
    await ds.query(`UPDATE reports SET assigned_to_id = $2 WHERE id = $1`, [id, analystB.id]);
    await get(analystA, id).expect(404);
    await get(analystB, id).expect(200);
  });

  it('revelação: o DPO decide pedido de outra pessoa; o próprio pedido dá 403 (four-eyes)', async () => {
    const { id } = await createBareReport(ds, { assignedToId: dpoAnalyst.id });
    const insert = async (by: string) =>
      (
        (await ds.query(
          `INSERT INTO identity_reveal_requests (report_id, requested_by_id, justification_enc)
           VALUES ($1, $2, '\\x00') RETURNING id::text AS id`,
          [id, by],
        )) as Array<{ id: string }>
      )[0].id;
    const fromAnalyst = await insert(analystA.id);
    const own = await insert(dpoAnalyst.id);
    await decide(dpo, id, fromAnalyst).expect(200);
    await decide(dpoAnalyst, id, own).expect(403);
    await decide(manager, id, fromAnalyst).expect(403);
  });

  it.each([SHORT, 'nao-e-uuid'])('id malformado (%s): 400, sem ACCESS_DENIED e sem eco', async (bad) => {
    const before = (await denials(analystB.id)).length;
    const res = await get(analystB, bad).expect(400);
    expect(JSON.stringify(res.body)).not.toContain(bad);
    expect(await denials(analystB.id)).toHaveLength(before);
  });

  it('nenhuma negação leva texto: metadata só com nomes de código e enums', async () => {
    const rows = (await ds.query(
      `SELECT metadata FROM audit_logs WHERE action = 'ACCESS_DENIED' AND metadata IS NOT NULL`,
    )) as Array<{ metadata: Record<string, unknown> }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const { metadata } of rows) {
      for (const value of Object.values(metadata)) {
        // Só nulo, booleano, número ou código curto; nunca objeto nem texto livre.
        const ok =
          value === null ||
          typeof value === 'boolean' ||
          typeof value === 'number' ||
          (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value));
        expect(ok, JSON.stringify(value)).toBe(true);
      }
      expect(JSON.stringify(metadata)).not.toContain(SHORT);
    }
  });
});
