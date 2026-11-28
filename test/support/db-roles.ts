import pg from 'pg';
import { requireEnv, withDatabase } from './db-urls.js';
import type { SuiteDatabase } from './test-database.js';

/** Perfis de banco que os testes de imutabilidade e de retenção exercitam. */
export type DbRole = 'app_runtime' | 'app_migrator' | 'app_audit_maintenance' | 'superuser';

function urlFor(suite: SuiteDatabase, role: DbRole): string {
  switch (role) {
    case 'app_runtime':
      return suite.runtimeUrl;
    case 'app_migrator':
      return suite.migratorUrl;
    case 'app_audit_maintenance':
      return withDatabase(requireEnv('DATABASE_AUDIT_MAINTENANCE_URL'), suite.name);
    case 'superuser':
      return withDatabase(requireEnv('TEST_ADMIN_DATABASE_URL'), suite.name);
  }
}

/** Abre uma conexão com o perfil informado no banco da suíte, roda `fn` e fecha. */
export async function withRole<T>(
  suite: SuiteDatabase,
  role: DbRole,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: urlFor(suite, role) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Mensagem do erro do Postgres, ou `null` se a consulta passou. */
export async function pgError(client: pg.Client, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
