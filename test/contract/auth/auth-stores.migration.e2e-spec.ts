import type { DataSource } from 'typeorm';
import { loadLocalEnv } from '../../support/db-urls.js';
import { withRole } from '../../support/db-roles.js';
import { migrationDataSource } from '../../support/migrations.js';
import { createSuiteDatabase, type SuiteDatabase } from '../../support/test-database.js';
import { applyTestEnv } from '../../support/test-env.js';

/** Migration AuthStores (T003, data-model.md): sessões no formato do pacote, colunas de MFA e `down()` funcional. */
describe('Migration AuthStores (e2e)', () => {
  let db: SuiteDatabase;
  let ds: DataSource;

  const columns = async (table: string): Promise<string[]> =>
    withRole(db, 'superuser', async (c) => {
      const r = await c.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name`,
        [table],
      );
      return r.rows.map((row: { column_name: string }) => row.column_name);
    });

  const tableExists = async (table: string): Promise<boolean> =>
    withRole(db, 'superuser', async (c) => {
      const r = await c.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
      return r.rows[0].ok as boolean;
    });

  /** Desfaz migrations da mais nova para a mais antiga até desfazer `name` (inclusive). */
  const undoUntil = async (name: string) => {
    for (let i = 0; i < 10; i++) {
      const [last] = (await ds.query(`SELECT name FROM typeorm_migrations ORDER BY id DESC LIMIT 1`)) as Array<{
        name: string;
      }>;
      await ds.undoLastMigration({ transaction: 'each' });
      if (last.name === name) return;
    }
    throw new Error(`migration ${name} não encontrada`);
  };

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

  it('up(): sessions no formato do SessionStore, sem renovação por tokens', async () => {
    expect(await columns('sessions')).toEqual([
      'created_at',
      'expires_at',
      'id',
      'last_active_at',
      'metadata',
      'mfa',
      'password_change_failures', // feature 006 (StaffSignIn)
      'user_id',
    ]);
  });

  it('up(): colunas de MFA em users, recovery_codes sem used_at e mfa_failures criada', async () => {
    const users = await columns('users');
    expect(users).toEqual(expect.arrayContaining(['mfa_secret_enc', 'mfa_pending_secret_enc', 'mfa_last_used_step']));
    expect(await columns('recovery_codes')).toEqual(['code_hash', 'id', 'user_id']);
    expect(await columns('mfa_failures')).toEqual(['failed_at', 'id', 'user_id']);
    expect(await tableExists('refresh_tokens')).toBe(false);
  });

  it('up(): o mesmo código de recuperação não entra duas vezes para o usuário', async () => {
    await withRole(db, 'superuser', async (c) => {
      const u = await c.query(
        `INSERT INTO users (name, email, password_hash) VALUES ('T', 'mig@example.com', 'x') RETURNING id`,
      );
      const id = u.rows[0].id as string;
      await c.query(`INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, 'h1')`, [id]);
      await expect(
        c.query(`INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, 'h1')`, [id]),
      ).rejects.toThrow();
      await expect(c.query(`UPDATE users SET mfa_enabled_at = now() WHERE id = $1`, [id])).rejects.toThrow();
      await c.query(`DELETE FROM recovery_codes WHERE user_id = $1`, [id]);
      await c.query(`DELETE FROM users WHERE id = $1`, [id]);
    });
  });

  it('down(): volta ao formato anterior e up() reaplica', async () => {
    // As migrations posteriores (StaffSignIn, feature 006) saem antes, na ordem inversa.
    await undoUntil('AuthStores1795900000000');
    expect(await columns('sessions')).toEqual(expect.arrayContaining(['refresh_token_hash', 'family_id']));
    expect(await tableExists('mfa_failures')).toBe(false);
    expect(await columns('recovery_codes')).toContain('used_at');
    await ds.runMigrations({ transaction: 'each' });
    expect(await columns('sessions')).toContain('last_active_at');
  });
});
