import pg from 'pg';
import { loadLocalEnv, requireEnv } from './db-urls.js';

/** Chave do advisory lock que serializa as suítes que giram a `report-kek` no Vault compartilhado (pendência F1). */
const KEK_ROTATION_LOCK = 7_201_003;

/**
 * Segura o lock até `release()`. As suítes de recifragem giram a mesma chave do Vault e, em paralelo, uma via a
 * rotação da outra ("nada a fazer" deixava de valer). Uso: `beforeAll(lock = await acquireKekRotationLock())` e
 * `afterAll(() => lock.release())`.
 */
export async function acquireKekRotationLock(): Promise<{ release(): Promise<void> }> {
  loadLocalEnv();
  const client = new pg.Client({ connectionString: requireEnv('TEST_ADMIN_DATABASE_URL') });
  await client.connect();
  await client.query('SELECT pg_advisory_lock($1)', [KEK_ROTATION_LOCK]);
  return {
    release: async () => {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [KEK_ROTATION_LOCK]);
      } finally {
        await client.end();
      }
    },
  };
}
