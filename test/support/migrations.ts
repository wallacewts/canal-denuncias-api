/// <reference types="vite/client" />
import { DataSource, type MigrationInterface } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/database.options.js';
import type { SuiteDatabase } from './test-database.js';

/** DataSource do perfil de migrations no banco da suíte, com as migrations em TypeScript (como o global-setup). */
export async function migrationDataSource(suite: SuiteDatabase): Promise<DataSource> {
  const modules = import.meta.glob<Record<string, new () => MigrationInterface>>('../../src/database/migrations/*.ts', {
    eager: true,
  });
  const migrations = Object.values(modules).flatMap((mod) => Object.values(mod));
  const ds = new DataSource({
    ...buildDataSourceOptions(suite.migratorUrl, false),
    migrations,
    migrationsTableName: 'typeorm_migrations',
    logging: ['error'],
  });
  return ds.initialize();
}
