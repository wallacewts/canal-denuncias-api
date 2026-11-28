import type { DataSource } from 'typeorm';
import { loadLocalEnv } from '../support/db-urls.js';
import { withRole } from '../support/db-roles.js';
import { migrationDataSource } from '../support/migrations.js';
import { createSuiteDatabase, type SuiteDatabase } from '../support/test-database.js';
import { applyTestEnv } from '../support/test-env.js';

/** Migration StaffSignIn (T004, data-model.md): contador de bloqueio e contador de troca de senha, com CHECK e down(). */
describe('Migration StaffSignIn (e2e)', () => {
  let db: SuiteDatabase;
  let ds: DataSource;

  const column = async (table: string, name: string) =>
    withRole(db, 'superuser', async (c) => {
      const r = await c.query(
        `SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        [table, name],
      );
      return r.rows[0] as { column_default: string; is_nullable: string } | undefined;
    });

  beforeAll(async () => {
    loadLocalEnv();
    applyTestEnv();
    db = await createSuiteDatabase();
    ds = await migrationDataSource(db);
  }, 120_000);

  afterAll(async () => {
    await ds?.destroy();
    await db.drop();
  });

  it('up(): colunas novas não nulas com padrão 0', async () => {
    expect(await column('users', 'lockout_level')).toEqual({ column_default: '0', is_nullable: 'NO' });
    expect(await column('sessions', 'password_change_failures')).toEqual({ column_default: '0', is_nullable: 'NO' });
  });

  it('up(): CHECK recusa valores fora da faixa', async () => {
    await withRole(db, 'superuser', async (c) => {
      const u = await c.query(
        `INSERT INTO users (name, email, password_hash) VALUES ('T', 'mig006@example.com', 'x') RETURNING id`,
      );
      const id = u.rows[0].id as string;
      await expect(c.query(`UPDATE users SET lockout_level = -1 WHERE id = $1`, [id])).rejects.toThrow();
      await expect(c.query(`UPDATE users SET lockout_level = 17 WHERE id = $1`, [id])).rejects.toThrow();
      await c.query(`UPDATE users SET lockout_level = 16 WHERE id = $1`, [id]);
      await c.query(
        `INSERT INTO sessions (id, user_id, created_at, expires_at, last_active_at) VALUES ('s006', $1, now(), now() + interval '1 hour', now())`,
        [id],
      );
      await expect(c.query(`UPDATE sessions SET password_change_failures = 6 WHERE id = 's006'`)).rejects.toThrow();
      await expect(c.query(`UPDATE sessions SET password_change_failures = -1 WHERE id = 's006'`)).rejects.toThrow();
      await c.query(`UPDATE sessions SET password_change_failures = 5 WHERE id = 's006'`);
      await c.query(`DELETE FROM users WHERE id = $1`, [id]);
    });
  });

  it('down(): remove as colunas e up() reaplica', async () => {
    await ds.undoLastMigration({ transaction: 'each' });
    expect(await column('users', 'lockout_level')).toBeUndefined();
    expect(await column('sessions', 'password_change_failures')).toBeUndefined();
    await ds.runMigrations({ transaction: 'each' });
    expect(await column('users', 'lockout_level')).toBeDefined();
  });
});
