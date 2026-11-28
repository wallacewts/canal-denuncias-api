/// <reference types="vite/client" />
import pg from 'pg';
import { DataSource, type MigrationInterface } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/database.options.js';
import { loadLocalEnv, requireEnv, SUITE_DATABASE_PREFIX, TEMPLATE_DATABASE, withDatabase } from './db-urls.js';

/**
 * Roda uma vez antes dos testes de integração: recria o banco-modelo `canal_test_template` com as migrations.
 * Cada suíte depois clona esse modelo (`test-database.ts`), porque `audit_logs` não aceita DELETE nem TRUNCATE
 * e não dá para limpar tabelas entre suítes (FR-034).
 */
export default async function setup(): Promise<void> {
  loadLocalEnv();
  const adminUrl = requireEnv('TEST_ADMIN_DATABASE_URL');
  const migratorUrl = withDatabase(requireEnv('DATABASE_MIGRATOR_URL'), TEMPLATE_DATABASE);

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // Restos de execuções interrompidas.
    const leftovers = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname = $1 OR datname LIKE $2`,
      [TEMPLATE_DATABASE, `${SUITE_DATABASE_PREFIX}%`],
    );
    for (const { datname } of leftovers.rows) {
      await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }

    // Perfil de manutenção da trilha (feature 003): o volume local pode ser anterior a ele. As migrations só concedem
    // os EXECUTE das funções de manutenção se o perfil existir.
    await admin.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_audit_maintenance') THEN
          CREATE ROLE app_audit_maintenance LOGIN PASSWORD 'dev_audit_maintenance_pw';
        END IF;
      END $$
    `);

    await admin.query(`CREATE DATABASE "${TEMPLATE_DATABASE}" OWNER app_migrator`);
  } finally {
    await admin.end();
  }

  // Mesmo preparo do docker/postgres/01-roles.sh, aplicado ao banco-modelo.
  const templateAdmin = new pg.Client({ connectionString: withDatabase(adminUrl, TEMPLATE_DATABASE) });
  await templateAdmin.connect();
  try {
    await templateAdmin.query(`
      ALTER SCHEMA public OWNER TO app_migrator;
      REVOKE ALL ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO app_runtime;
      GRANT USAGE ON SCHEMA public TO app_audit_maintenance;
      ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
      ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
      ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO app_runtime;
    `);
  } finally {
    await templateAdmin.end();
  }

  // Migrations carregadas pelo Vite (TypeScript), sem depender do build em dist/.
  const modules = import.meta.glob<Record<string, new () => MigrationInterface>>('../../src/database/migrations/*.ts', {
    eager: true,
  });
  const migrations = Object.values(modules).flatMap((mod) => Object.values(mod));

  const dataSource = new DataSource({
    ...buildDataSourceOptions(migratorUrl, false),
    migrations,
    migrationsTableName: 'typeorm_migrations',
    logging: ['error'],
  });
  await dataSource.initialize();
  try {
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
}
