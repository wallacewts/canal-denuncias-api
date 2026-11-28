import type { DataSource } from 'typeorm';
import { insertChainedRows } from '../support/audit-chain.js';
import { loadLocalEnv } from '../support/db-urls.js';
import { pgError, withRole } from '../support/db-roles.js';
import { migrationDataSource } from '../support/migrations.js';
import { createSuiteDatabase, type SuiteDatabase } from '../support/test-database.js';
import { applyTestEnv } from '../support/test-env.js';

interface Snapshot {
  rows: Array<{ id: string; prev_hash: string; hash: string; occurred_at: string }>;
  partitioned: boolean;
}

/**
 * Migração da trilha para particionada (US7, R11, FR-031): preserva ids, horários e hashes, mantém a imutabilidade, e
 * o down() volta à tabela comum com a mesma conferência.
 */
describe('Migration AuditLogPartitioning (e2e)', () => {
  let db: SuiteDatabase;
  let ds: DataSource;

  const snapshot = async (): Promise<Snapshot> =>
    withRole(db, 'superuser', async (c) => {
      const rows = await c.query(
        `SELECT l.id::text, encode(l.prev_hash, 'hex') AS prev_hash, encode(l.hash, 'hex') AS hash, l.occurred_at::text
         FROM audit_logs l ORDER BY l.id`,
      );
      const kind = await c.query(`SELECT relkind FROM pg_class WHERE relname = 'audit_logs'`);
      return { rows: rows.rows, partitioned: kind.rows[0].relkind === 'p' };
    });

  /** Desfaz as migrations até a AuditLogPartitioning, inclusive (as posteriores a ela são desfeitas antes). */
  const undoPartitioning = async () => {
    const lastName = async () =>
      ((await ds.query(`SELECT name FROM typeorm_migrations ORDER BY id DESC LIMIT 1`)) as Array<{ name: string }>)[0]
        .name;
    while (!(await lastName()).startsWith('AuditLogPartitioning')) await ds.undoLastMigration({ transaction: 'each' });
    await ds.undoLastMigration({ transaction: 'each' });
  };

  beforeAll(async () => {
    loadLocalEnv();
    applyTestEnv();
    db = await createSuiteDatabase();
    ds = await migrationDataSource(db);
    // Volta ao estado anterior ao particionamento (desfazendo também as migrations posteriores a ele) e grava uma
    // trilha em três meses diferentes.
    await undoPartitioning();
    await withRole(db, 'app_runtime', (c) =>
      insertChainedRows(c, [
        { occurredAt: new Date('2026-09-15T10:00:00.000Z'), resourceId: 'a' },
        { occurredAt: new Date('2026-10-02T10:00:00.000Z'), resourceId: 'b' },
        { occurredAt: new Date('2026-11-20T10:00:00.000Z'), resourceId: 'c' },
      ]),
    );
  }, 120_000);

  afterAll(async () => {
    await ds?.destroy();
    await db.drop();
  });

  it('o estado anterior é a tabela comum', async () => {
    expect((await snapshot()).partitioned).toBe(false);
  });

  it('up(): tabela particionada com os mesmos ids, horários e hashes, e a sequência continua', async () => {
    const before = await snapshot();
    await ds.runMigrations({ transaction: 'each' });
    const after = await snapshot();
    expect(after.partitioned).toBe(true);
    expect(after.rows).toEqual(before.rows);
    const next = await withRole(db, 'app_runtime', async (c) => {
      const prev = Buffer.from(after.rows.at(-1)!.hash, 'hex');
      await insertChainedRows(c, [{ occurredAt: new Date(), resourceId: 'd' }], prev);
      return (await c.query(`SELECT max(id)::text AS id FROM audit_logs`)).rows[0].id as string;
    });
    expect(BigInt(next)).toBeGreaterThan(BigInt(after.rows.at(-1)!.id));
  });

  it('as partições existem do mês mais antigo até 12 meses à frente, cada uma protegida', async () => {
    const names = await withRole(db, 'superuser', async (c) =>
      (
        await c.query<{ name: string }>(
          `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
           JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'audit_logs' ORDER BY 1`,
        )
      ).rows.map((r) => r.name),
    );
    expect(names[0]).toBe('audit_logs_2026_09');
    expect(names.length).toBeGreaterThanOrEqual(15);
    await withRole(db, 'app_runtime', async (c) => {
      expect(await pgError(c, `DELETE FROM audit_logs_2026_09`)).toMatch(/permission denied/);
    });
    await withRole(db, 'app_migrator', async (c) => {
      expect(await pgError(c, `TRUNCATE audit_logs_2026_10`)).toMatch(/append-only/);
    });
  });

  it('down(): volta à tabela comum preservando tudo; up() de novo deixa o banco como estava', async () => {
    const partitioned = await snapshot();
    await undoPartitioning();
    const plain = await snapshot();
    expect(plain.partitioned).toBe(false);
    expect(plain.rows).toEqual(partitioned.rows);
    await withRole(db, 'app_migrator', async (c) => {
      expect(await pgError(c, `DELETE FROM audit_logs`)).toMatch(/append-only/);
    });
    await ds.runMigrations({ transaction: 'each' });
    expect((await snapshot()).rows).toEqual(partitioned.rows);
  });

  it('um registro fora das partições previstas aborta a migration sem perder nada', async () => {
    await undoPartitioning();
    const before = await snapshot();
    await withRole(db, 'app_runtime', (c) =>
      insertChainedRows(
        c,
        [{ occurredAt: new Date('2099-01-01T00:00:00.000Z'), resourceId: 'futuro' }],
        Buffer.from(before.rows.at(-1)!.hash, 'hex'),
      ),
    );
    const withFuture = await snapshot();
    await expect(ds.runMigrations({ transaction: 'each' })).rejects.toThrow();
    const after = await snapshot();
    expect(after.partitioned).toBe(false);
    expect(after.rows).toEqual(withFuture.rows);
  });
});
