import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { KEY_SERVICE, type KeyService } from '../../../src/infra/vault/key-service.js';
import { PgMfaStore } from '../../../src/infra/auth/stores/pg-mfa.store.js';
import { createTestApp, type TestApp } from '../../support/test-app.js';

/**
 * Segredo TOTP selado pelo Vault (T005, R1, princípio III): o banco nunca guarda o segredo base32, ele só abre preso ao
 * mesmo usuário, e nenhuma chamada ao Vault acontece com transação aberta.
 */
describe('PgMfaStore: selagem do segredo (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;
  let store: PgMfaStore;
  const SECRET = 'JBSWY3DPEHPK3PXP';
  const SHORT = 'XQZ';

  const newUser = async (): Promise<string> => {
    const r = (await ds.query(
      `INSERT INTO users (name, email, password_hash) VALUES ('Mfa', gen_random_uuid() || '@mfa.test', 'x') RETURNING id`,
    )) as Array<{ id: string }>;
    return r[0].id;
  };

  const raw = async (id: string) =>
    (
      (await ds.query(
        `SELECT convert_from(mfa_secret_enc, 'UTF8') AS secret, convert_from(mfa_pending_secret_enc, 'UTF8') AS pending
         FROM users WHERE id = $1`,
        [id],
      )) as Array<{ secret: string | null; pending: string | null }>
    )[0];

  beforeAll(async () => {
    t = await createTestApp({ vault: 'api' });
    ds = t.app.get<DataSource>(getDataSourceToken());
    store = t.app.get(PgMfaStore);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it.each([SECRET, SHORT])('nunca grava o segredo em claro e devolve o original (%s)', async (secret) => {
    const id = await newUser();
    await store.saveTotp(id, { secret, confirmed: false, pendingSecret: secret });
    const row = await raw(id);
    expect(row.secret).not.toContain(secret);
    expect(row.pending).not.toContain(secret);
    expect(row.secret).toMatch(/^vault:v\d+:/);
    expect(await store.getTotp(id)).toEqual({ secret, confirmed: false, pendingSecret: secret });
  });

  it('o valor selado de um usuário não abre no outro', async () => {
    const a = await newUser();
    const b = await newUser();
    await store.saveTotp(a, { secret: SECRET, confirmed: true });
    await ds.query(`UPDATE users SET mfa_secret_enc = (SELECT mfa_secret_enc FROM users WHERE id = $1) WHERE id = $2`, [
      a,
      b,
    ]);
    await ds.query(`UPDATE users SET mfa_enabled_at = now() WHERE id = $1`, [b]);
    await expect(store.getTotp(b)).rejects.toThrow();
  });

  it('nenhuma chamada ao Vault com transação aberta', async () => {
    const keys = t.app.get<KeyService>(KEY_SERVICE);
    const openTx: number[] = [];
    const inTransaction = async () => {
      const rows = (await ds.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND state LIKE 'idle in transaction%'`,
      )) as Array<{ n: number }>;
      openTx.push(rows[0].n);
    };
    const encrypt = keys.encrypt.bind(keys);
    const decrypt = keys.decrypt.bind(keys);
    keys.encrypt = async (...args) => {
      await inTransaction();
      return encrypt(...args);
    };
    keys.decrypt = async (...args) => {
      await inTransaction();
      return decrypt(...args);
    };
    try {
      const id = await newUser();
      await store.saveTotp(id, { secret: SECRET, confirmed: true });
      await store.getTotp(id);
    } finally {
      keys.encrypt = encrypt;
      keys.decrypt = decrypt;
    }
    expect(openTx.length).toBeGreaterThan(0);
    expect(openTx.every((n) => n === 0)).toBe(true);
  });
});
