import { pgError, withRole } from '../support/db-roles.js';
import { createSuiteDatabase, type SuiteDatabase } from '../support/test-database.js';
import { loadLocalEnv } from '../support/db-urls.js';
import { applyTestEnv } from '../support/test-env.js';

/**
 * Imutabilidade da trilha provada no CI (US4, AUDIT-08, D11). Se uma migration futura desfizer o REVOKE, o gatilho ou
 * a CHECK de IP, esta suíte falha.
 */
describe('Imutabilidade da trilha de auditoria (e2e)', () => {
  let db: SuiteDatabase;

  const INSERT = `INSERT INTO audit_logs (occurred_at, actor_type, action, resource_type, result, ip, prev_hash, hash)
                  VALUES (now(), $1, 'REPORT_VIEWED', 'report', 'SUCCESS', $2, $3, $4)`;

  beforeAll(async () => {
    loadLocalEnv();
    applyTestEnv();
    db = await createSuiteDatabase();
    await withRole(db, 'app_runtime', (c) => c.query(INSERT, ['SYSTEM', null, Buffer.alloc(32), Buffer.alloc(32, 1)]));
  });

  afterAll(async () => {
    await db.drop();
  });

  it('app_runtime: UPDATE e DELETE falham por falta de permissão', async () => {
    await withRole(db, 'app_runtime', async (c) => {
      expect(await pgError(c, `UPDATE audit_logs SET action = 'XQZ'`)).toMatch(/permission denied/);
      expect(await pgError(c, `DELETE FROM audit_logs`)).toMatch(/permission denied/);
      expect(await pgError(c, `TRUNCATE audit_logs`)).toMatch(/permission denied/);
    });
  });

  it('app_migrator (dono): UPDATE, DELETE e TRUNCATE falham pelo gatilho', async () => {
    await withRole(db, 'app_migrator', async (c) => {
      expect(await pgError(c, `UPDATE audit_logs SET action = 'XQZ'`)).toMatch(/append-only/);
      expect(await pgError(c, `DELETE FROM audit_logs`)).toMatch(/append-only/);
      expect(await pgError(c, `TRUNCATE audit_logs`)).toMatch(/append-only/);
    });
  });

  it('o banco recusa registro de denunciante com IP (CHECK)', async () => {
    await withRole(db, 'app_runtime', async (c) => {
      const error = await pgError(c, INSERT, ['REPORTER', '203.0.113.9', Buffer.alloc(32, 2), Buffer.alloc(32, 3)]);
      expect(error).toMatch(/audit_ip_only_for_staff/);
    });
  });

  it('a trilha continua com o único registro inserido', async () => {
    const n = await withRole(
      db,
      'app_runtime',
      async (c) => (await c.query(`SELECT count(*)::int AS n FROM audit_logs`)).rows[0].n,
    );
    expect(n).toBe(1);
  });

  describe('por partição (US7)', () => {
    const currentPartition = () => {
      const now = new Date();
      return `audit_logs_${now.getUTCFullYear()}_${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    };

    it('app_runtime não faz UPDATE, DELETE nem TRUNCATE direto numa partição', async () => {
      await withRole(db, 'app_runtime', async (c) => {
        const p = currentPartition();
        expect(await pgError(c, `UPDATE ${p} SET action = 'XQZ'`)).toMatch(/permission denied/);
        expect(await pgError(c, `DELETE FROM ${p}`)).toMatch(/permission denied/);
        expect(await pgError(c, `TRUNCATE ${p}`)).toMatch(/permission denied/);
      });
    });

    it('app_migrator não faz UPDATE, DELETE nem TRUNCATE numa partição (gatilhos)', async () => {
      await withRole(db, 'app_migrator', async (c) => {
        const p = currentPartition();
        expect(await pgError(c, `UPDATE ${p} SET action = 'XQZ'`)).toMatch(/append-only/);
        expect(await pgError(c, `DELETE FROM ${p}`)).toMatch(/append-only/);
        expect(await pgError(c, `TRUNCATE ${p}`)).toMatch(/append-only/);
      });
    });

    it('app_runtime não executa as funções de manutenção', async () => {
      await withRole(db, 'app_runtime', async (c) => {
        expect(await pgError(c, `SELECT audit_ensure_partitions(3)`)).toMatch(/permission denied/);
        expect(await pgError(c, `SELECT audit_purge_partition('audit_logs_2020_01')`)).toMatch(/permission denied/);
      });
    });

    it('audit_purges é append-only e só leitura para a API', async () => {
      await withRole(db, 'app_runtime', async (c) => {
        expect(
          await pgError(
            c,
            `INSERT INTO audit_purges (partition_name, purged_through, rows_removed) VALUES ('x', now() - interval '6 years', 0)`,
          ),
        ).toMatch(/permission denied/);
      });
      // O gatilho de linha só dispara se houver linha: uma âncora válida (mais de 5 anos) gravada pelo superusuário.
      await withRole(db, 'superuser', (c) =>
        c.query(`INSERT INTO audit_purges (partition_name, purged_through, rows_removed)
                 VALUES ('audit_logs_2019_01', now() - interval '6 years', 0)`),
      );
      await withRole(db, 'app_migrator', async (c) => {
        expect(await pgError(c, `UPDATE audit_purges SET rows_removed = 1`)).toMatch(/append-only/);
        expect(await pgError(c, `DELETE FROM audit_purges`)).toMatch(/append-only/);
        expect(await pgError(c, `TRUNCATE audit_purges`)).toMatch(/append-only/);
      });
    });
  });
});
