import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { requireEnv, SUITE_DATABASE_PREFIX, TEMPLATE_DATABASE, withDatabase } from './db-urls.js';

export interface SuiteDatabase {
  name: string;
  /** Perfil da API (`app_runtime`). */
  runtimeUrl: string;
  /** Perfil das migrations (`app_migrator`), dono do schema. */
  migratorUrl: string;
  drop(): Promise<void>;
}

/** Chave do advisory lock que serializa as clonagens: o Postgres recusa clonar um modelo em uso. */
const CLONE_LOCK_KEY = 7_201_001;

/** Cria um banco só desta suíte, clonado do modelo com as migrations já aplicadas. */
export async function createSuiteDatabase(): Promise<SuiteDatabase> {
  const adminUrl = requireEnv('TEST_ADMIN_DATABASE_URL');
  const name = `${SUITE_DATABASE_PREFIX}${randomBytes(6).toString('hex')}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query('SELECT pg_advisory_lock($1)', [CLONE_LOCK_KEY]);
    try {
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE_DATABASE}" OWNER app_migrator`);
    } finally {
      await admin.query('SELECT pg_advisory_unlock($1)', [CLONE_LOCK_KEY]);
    }
  } finally {
    await admin.end();
  }

  return {
    name,
    runtimeUrl: withDatabase(requireEnv('DATABASE_URL'), name),
    migratorUrl: withDatabase(requireEnv('DATABASE_MIGRATOR_URL'), name),
    drop: () => dropSuiteDatabase(name),
  };
}

export async function dropSuiteDatabase(name: string): Promise<void> {
  const admin = new pg.Client({ connectionString: requireEnv('TEST_ADMIN_DATABASE_URL') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
