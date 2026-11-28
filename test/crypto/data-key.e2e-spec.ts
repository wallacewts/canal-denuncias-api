import { DataSource } from 'typeorm';
import { KeyServiceRequestError, KeyServiceUnavailableError } from '../../src/infra/vault/key-service.errors.js';
import { VaultAuth } from '../../src/infra/vault/vault-auth.js';
import { VaultClient } from '../../src/infra/vault/vault.client.js';
import { DataKeyService } from '../../src/modules/crypto/data-key.service.js';
import { encryptionContext } from '../../src/modules/crypto/encryption-context.js';
import { openField, sealField } from '../../src/modules/crypto/field-cipher.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Contra o Vault local, com o AppRole `api` de dev (G1): prova que a política real da API basta. */
describe('DataKeyService contra o Vault real (e2e)', () => {
  let t: TestApp;
  let svc: DataKeyService;
  let ds: DataSource;

  beforeAll(async () => {
    t = await createTestApp({ vault: 'api' });
    svc = t.app.get(DataKeyService);
    ds = t.app.get(DataSource);
  });

  afterAll(async () => {
    await t.close();
  });

  it('cria a chave, guarda só o wrapped e abre de novo', async () => {
    const id = '019a2f1f-709b-777e-8662-bc1280bce2a3';
    const ctx = encryptionContext('messages.body_enc', id);
    const { result: sealed, wrapped } = await svc.createReportKey((dek) => sealField(Buffer.from('XQZ'), dek, ctx));
    expect(wrapped).toMatch(/^vault:v\d+:/);
    const opened = await svc.withReportKey(wrapped, (dek) => openField(sealed, dek, ctx));
    expect(opened.toString()).toBe('XQZ');
  });

  it('cifrar e gravar não chama o Vault com transação aberta', async () => {
    const original = globalThis.fetch;
    const openTxAtVaultCall: number[] = [];
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const [{ n }] = (await ds.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND state LIKE 'idle in transaction%' AND pid <> pg_backend_pid()`,
      )) as Array<{ n: number }>;
      openTxAtVaultCall.push(n);
      return original(...args);
    }) as typeof fetch;
    try {
      // Padrão do contrato: chave e cifragem antes; transação só para gravar.
      const id = '019a2f1f-709b-7000-8000-000000000001';
      const ctx = encryptionContext('reports.content_enc', id);
      const { result: sealed, wrapped } = await svc.createReportKey((dek) => sealField(Buffer.from('XQZ'), dek, ctx));
      await ds.transaction(async (m) => {
        await m.query('SELECT $1::bytea, $2::text', [sealed, wrapped]);
      });
      await svc.withReportKey(wrapped, (dek) => openField(sealed, dek, ctx));
    } finally {
      globalThis.fetch = original;
    }
    expect(openTxAtVaultCall.length).toBeGreaterThan(0);
    expect(openTxAtVaultCall.every((n) => n === 0)).toBe(true);
  });

  it('wrapped corrompido ou de outra KEK gera erro genérico sem expor o valor guardado', async () => {
    const corrupted = 'vault:v1:QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=';
    const fromAppKek = await new VaultClient({
      addr: process.env.VAULT_ADDR!,
      timeoutMs: 2000,
      auth: new VaultAuth({ addr: process.env.VAULT_ADDR!, token: 'dev-root-token', timeoutMs: 2000 }),
    }).encrypt('app-kek', Buffer.alloc(32, 7));
    for (const wrapped of [corrupted, fromAppKek, 'XQZ']) {
      const before = t.logs.lines().length;
      const error = await svc.withReportKey(wrapped, () => 'nunca').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(KeyServiceRequestError);
      const text = [String(error), JSON.stringify(error), (error as Error).stack].join('\n');
      expect(text).not.toContain(wrapped);
      expect(JSON.stringify(t.logs.lines().slice(before))).not.toContain(wrapped);
    }
  });

  it('Vault inacessível gera KeyServiceUnavailableError com mensagem fixa', async () => {
    const auth = new VaultAuth({ addr: 'http://127.0.0.1:1', token: 'x', timeoutMs: 300 });
    const offline = new DataKeyService(new VaultClient({ addr: 'http://127.0.0.1:1', timeoutMs: 300, auth }));
    const error = await offline.createReportKey(() => 'nunca').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeyServiceUnavailableError);
    expect((error as Error).message).toBe('Serviço de chaves indisponível');
  });
});
