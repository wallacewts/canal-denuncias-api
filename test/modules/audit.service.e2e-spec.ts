import { DataSource } from 'typeorm';
import { ActorType } from '../../src/common/enums/actor-type.enum.js';
import { AuditResult } from '../../src/common/enums/audit-result.enum.js';
import { AuditAction, AuditResourceType } from '../../src/modules/audit/audit-action.enum.js';
import { computeAuditHash, GENESIS_HASH } from '../../src/modules/audit/audit-hash.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import type { AuditLog } from '../../src/modules/audit/entities/audit-log.entity.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

describe('AuditService.record (e2e)', () => {
  let t: TestApp;
  let audit: AuditService;
  let ds: DataSource;

  beforeAll(async () => {
    t = await createTestApp();
    audit = t.app.get(AuditService);
    ds = t.app.get(DataSource);
  });

  afterAll(async () => {
    await t.close();
  });

  /** Uma ação do catálogo; o marcador vai no id do recurso. A metadata aninhada exercita a forma canônica. */
  const entry = (tag: string) => ({
    actorType: ActorType.SYSTEM,
    action: AuditAction.AUDIT_LOG_VIEWED,
    resourceType: AuditResourceType.AUDIT_LOG,
    resourceId: tag,
    result: AuditResult.SUCCESS,
    metadata: { count: 2, filters: { to: '2026-11-28T00:00:00.000Z', action: AuditAction.USER_CREATED } },
  });

  async function chain(): Promise<AuditLog[]> {
    return ds.query(`SELECT * FROM audit_logs ORDER BY id`).then((rows: Array<Record<string, unknown>>) =>
      rows.map((r) => ({
        id: String(r.id),
        occurredAt: r.occurred_at as Date,
        actorType: r.actor_type as ActorType,
        actorUserId: r.actor_user_id as string | null,
        action: r.action as string,
        resourceType: r.resource_type as string,
        resourceId: r.resource_id as string | null,
        result: r.result as AuditResult,
        ip: r.ip as string | null,
        userAgent: r.user_agent as string | null,
        metadata: r.metadata as Record<string, unknown> | null,
        prevHash: r.prev_hash as Buffer,
        hash: r.hash as Buffer,
      })),
    );
  }

  function assertValidChain(rows: AuditLog[]): void {
    let prev = GENESIS_HASH;
    for (const row of rows) {
      expect(row.prevHash.equals(prev)).toBe(true);
      expect(row.hash.equals(computeAuditHash(row.prevHash, row))).toBe(true);
      prev = row.hash;
    }
  }

  it('o primeiro registro usa a gênese (32 bytes zerados) e o hash confere com o que foi salvo', async () => {
    await audit.record(entry('PRIMEIRO'));
    const [first] = await chain();
    expect(first!.prevHash.equals(Buffer.alloc(32))).toBe(true);
    assertValidChain(await chain());
  });

  it('50 gravações concorrentes formam uma cadeia única, sem bifurcação', async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => audit.record(entry(`CONCORRENTE_${i}`))));
    const rows = await chain();
    expect(rows.length).toBeGreaterThanOrEqual(51);
    expect(new Set(rows.map((r) => r.prevHash.toString('hex'))).size).toBe(rows.length);
    assertValidChain(rows);
  });

  it('na transação do chamador, um rollback desfaz o registro', async () => {
    const before = (await chain()).length;
    await ds
      .transaction(async (manager) => {
        await audit.record(entry('DESFEITO'), manager);
        throw new Error('rollback');
      })
      .catch(() => undefined);
    expect((await chain()).length).toBe(before);
  });

  it('ator que não é STAFF nunca grava IP nem user-agent', async () => {
    const saved = await audit.record({
      ...entry('SEM_IP'),
      actorType: ActorType.REPORTER,
      ip: '203.0.113.9',
      userAgent: 'X',
    });
    const [row] = await ds.query(`SELECT ip, user_agent FROM audit_logs WHERE id = $1`, [saved.id]);
    expect(row).toEqual({ ip: null, user_agent: null });
  });

  it('a metadata canônica não depende da ordem das chaves', () => {
    const base = {
      ...entry('X'),
      occurredAt: new Date('2026-11-27T12:00:00.000Z'),
      actorUserId: null,
      resourceId: null,
      ip: null,
      userAgent: null,
    };
    expect(
      computeAuditHash(GENESIS_HASH, { ...base, metadata: { a: 1, b: 2 } }).equals(
        computeAuditHash(GENESIS_HASH, { ...base, metadata: { b: 2, a: 1 } }),
      ),
    ).toBe(true);
  });
});
