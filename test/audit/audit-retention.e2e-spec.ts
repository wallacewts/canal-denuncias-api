import { DataSource } from 'typeorm';
import { AuditMaintenanceService } from '../../src/modules/audit/audit-maintenance.service.js';
import { AuditVerifierService } from '../../src/modules/audit/audit-verifier.service.js';
import { createOldPartition, insertChainedRows, lastHash } from '../support/audit-chain.js';
import { pgError, withRole } from '../support/db-roles.js';
import { requireEnv, withDatabase } from '../support/db-urls.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

const monthName = (offset: number): string => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return `audit_logs_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * Guarda de 5 anos (US7, R8 a R10, FR-028 a FR-030). As partições com mais de 5 anos são criadas pelo teste como
 * superusuário, com a mesma proteção que a função aplica, e recebem registros encadeados.
 */
describe('Retenção da trilha: partições e expurgo (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;
  let maintenance: AuditMaintenanceService;
  let maintenanceUrl: string;

  const partitions = async () =>
    withRole(t.database, 'superuser', async (c) =>
      (
        await c.query<{ name: string }>(
          `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
           JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'audit_logs' ORDER BY 1`,
        )
      ).rows.map((r) => r.name),
    );
  const count = async (sql: string) => Number(((await ds.query(sql)) as Array<{ n: number }>)[0]!.n);

  beforeAll(async () => {
    t = await createTestApp();
    ds = t.app.get(DataSource);
    maintenance = t.app.get(AuditMaintenanceService);
    maintenanceUrl = withDatabase(requireEnv('DATABASE_AUDIT_MAINTENANCE_URL'), t.database.name);
    await withRole(t.database, 'superuser', async (c) => {
      await createOldPartition(c, 2020, 1);
      await createOldPartition(c, 2020, 2);
    });
    await withRole(t.database, 'app_runtime', (c) =>
      insertChainedRows(c, [
        { occurredAt: new Date('2020-01-10T00:00:00.000Z'), resourceId: 'velho-1' },
        { occurredAt: new Date('2020-01-20T00:00:00.000Z'), resourceId: 'velho-2' },
        { occurredAt: new Date('2020-02-10T00:00:00.000Z'), resourceId: 'velho-3' },
        { occurredAt: new Date('2020-02-20T00:00:00.000Z'), resourceId: 'velho-4' },
        { occurredAt: new Date(), resourceId: 'novo-1' },
        { occurredAt: new Date(), resourceId: 'novo-2' },
      ]),
    );
  });

  afterAll(async () => {
    await t.close();
  });

  it('a função cria as partições que faltam, cada uma com gatilho de TRUNCATE e sem DELETE para a API', async () => {
    await withRole(t.database, 'superuser', async (c) => {
      for (const offset of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
        await c.query(`DROP TABLE IF EXISTS ${monthName(offset)}`);
    });
    const created = await withRole(t.database, 'app_audit_maintenance', async (c) =>
      Number((await c.query(`SELECT audit_ensure_partitions(3) AS n`)).rows[0].n),
    );
    expect(created).toBe(2);
    expect(await partitions()).toEqual(expect.arrayContaining([monthName(2), monthName(3)]));
    await withRole(t.database, 'app_runtime', async (c) => {
      expect(await pgError(c, `DELETE FROM ${monthName(3)}`)).toMatch(/permission denied/);
    });
    await withRole(t.database, 'app_migrator', async (c) => {
      expect(await pgError(c, `TRUNCATE ${monthName(3)}`)).toMatch(/append-only/);
    });
  });

  it.each([
    ['partição que não é a mais antiga', 'audit_logs_2020_02'],
    ['partição recente', monthName(0)],
    ['nome que não é partição', 'XQZ'],
  ])('recusa remover %s, com mensagem fixa', async (_caso, name) => {
    await withRole(t.database, 'app_audit_maintenance', async (c) => {
      const error = await pgError(c, `SELECT audit_purge_partition($1)`, [name]);
      expect(error).toMatch(/expurgo recusado/i);
      expect(error).not.toContain('XQZ');
    });
  });

  it('--dry-run não altera nada', async () => {
    const before = await partitions();
    const result = await maintenance.run({ url: maintenanceUrl, dryRun: true });
    expect(result).toEqual({ partitionsCreated: 0, partitionsPurged: 2, rowsRemoved: 4 });
    expect(await partitions()).toEqual(before);
  });

  it('expurgo interrompido depois da âncora desfaz âncora, partição e registro juntos (C3)', async () => {
    await expect(
      maintenance.run({
        url: maintenanceUrl,
        beforeCommit: () => {
          throw new Error('interrompido');
        },
      }),
    ).rejects.toThrow();
    expect(await partitions()).toEqual(expect.arrayContaining(['audit_logs_2020_01', 'audit_logs_2020_02']));
    expect(await count(`SELECT count(*)::int AS n FROM audit_purges`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'AUDIT_LOG_PURGED'`)).toBe(0);
  });

  it('remove só as partições com mais de 5 anos, da mais antiga, com âncora e AUDIT_LOG_PURGED na mesma transação', async () => {
    const result = await maintenance.run({ url: maintenanceUrl });
    expect(result).toEqual({ partitionsCreated: 0, partitionsPurged: 2, rowsRemoved: 4 });
    const names = await partitions();
    expect(names).not.toContain('audit_logs_2020_01');
    expect(names).not.toContain('audit_logs_2020_02');
    const purges = (await ds.query(
      `SELECT partition_name, rows_removed::int AS rows FROM audit_purges ORDER BY id`,
    )) as Array<Record<string, unknown>>;
    expect(purges).toEqual([
      { partition_name: 'audit_logs_2020_01', rows: 2 },
      { partition_name: 'audit_logs_2020_02', rows: 2 },
    ]);
    const records = (await ds.query(
      `SELECT actor_type, metadata->>'partition' AS partition FROM audit_logs WHERE action = 'AUDIT_LOG_PURGED' ORDER BY id`,
    )) as Array<Record<string, unknown>>;
    expect(records).toEqual([
      { actor_type: 'SYSTEM', partition: 'audit_logs_2020_01' },
      { actor_type: 'SYSTEM', partition: 'audit_logs_2020_02' },
    ]);
  });

  it('depois do expurgo, a verificação é íntegra e informa a âncora', async () => {
    const [{ id }] = (await ds.query(`SELECT min(id)::text AS id FROM audit_logs`)) as Array<{ id: string }>;
    const result = await t.app.get(AuditVerifierService).verify();
    expect(result).toEqual(expect.objectContaining({ ok: true, firstBrokenId: null, anchoredAt: id }));
  });

  it('a trilha segue gravando e a verificação continua íntegra', async () => {
    await withRole(t.database, 'app_runtime', async (c) =>
      insertChainedRows(c, [{ occurredAt: new Date(), resourceId: 'novo-3' }], await lastHash(c)),
    );
    const result = await t.app.get(AuditVerifierService).verify();
    expect(result.ok).toBe(true);
  });

  it('remover por fora o primeiro registro restante (superusuário, só no teste) quebra a verificação', async () => {
    await withRole(t.database, 'superuser', async (c) => {
      await c.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable');
      await c.query(`DELETE FROM audit_logs WHERE id = (SELECT min(id) FROM audit_logs)`);
      await c.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable');
    });
    expect((await t.app.get(AuditVerifierService).verify()).ok).toBe(false);
  });
});
