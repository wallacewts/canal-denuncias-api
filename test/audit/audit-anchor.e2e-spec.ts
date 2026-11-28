import { DataSource } from 'typeorm';
import { AuditVerifierService } from '../../src/modules/audit/audit-verifier.service.js';
import { insertChainedRows, lastHash } from '../support/audit-chain.js';
import { pgError, withRole } from '../support/db-roles.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/**
 * Ninguém "recomeça" a cadeia (US7, R9, FR-030): apagar o início da trilha por fora e forjar um registro de expurgo
 * sem âncora gravada pela função resulta em quebra.
 */
describe('Âncora da cadeia forjada (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;

  beforeAll(async () => {
    t = await createTestApp();
    ds = t.app.get(DataSource);
    await withRole(t.database, 'app_runtime', (c) =>
      insertChainedRows(
        c,
        Array.from({ length: 4 }, (_, i) => ({ occurredAt: new Date(), resourceId: `r${i}` })),
      ),
    );
  });

  afterAll(async () => {
    await t.close();
  });

  it('apagar registros recentes do início (superusuário, só no teste) quebra a verificação', async () => {
    await withRole(t.database, 'superuser', async (c) => {
      await c.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable');
      await c.query(`DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs ORDER BY id LIMIT 2)`);
      await c.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable');
    });
    const result = await t.app.get(AuditVerifierService).verify();
    expect(result.ok).toBe(false);
    expect(result.anchoredAt).toBeNull();
  });

  it('um AUDIT_LOG_PURGED inserido pela API, sem âncora em audit_purges, não conserta a cadeia', async () => {
    await withRole(t.database, 'app_runtime', async (c) => {
      await insertChainedRows(
        c,
        [{ occurredAt: new Date(), action: 'AUDIT_LOG_PURGED', resourceId: 'forjado' }],
        await lastHash(c),
      );
    });
    expect((await t.app.get(AuditVerifierService).verify()).ok).toBe(false);
  });

  it('uma âncora com prazo menor que 5 anos é recusada pelo banco', async () => {
    await withRole(t.database, 'superuser', async (c) => {
      const error = await pgError(
        c,
        `INSERT INTO audit_purges (partition_name, purged_through, rows_removed, purged_at)
         VALUES ('audit_logs_2025_01', '2025-02-01', 0, now())`,
      );
      expect(error).toMatch(/check constraint/);
    });
    expect(
      Number(((await ds.query(`SELECT count(*)::int AS n FROM audit_purges`)) as Array<{ n: number }>)[0]!.n),
    ).toBe(0);
  });
});
