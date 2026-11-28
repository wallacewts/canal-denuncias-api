import { KEY_SERVICE, type KeyService } from '../../src/infra/vault/key-service.js';
import { VaultAuth } from '../../src/infra/vault/vault-auth.js';
import { VaultClient } from '../../src/infra/vault/vault.client.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Contra o Vault do docker compose (ou o serviço do CI), já com as KEKs e o AppRole de dev. */
describe('Serviço de chaves contra o Vault real (e2e)', () => {
  let t: TestApp;
  let keys: KeyService;

  beforeAll(async () => {
    t = await createTestApp();
    keys = t.app.get<KeyService>(KEY_SERVICE);
  });

  afterAll(async () => {
    await t.close();
  });

  it('gera uma chave de dados e a abre de volta (report-kek)', async () => {
    const dek = await keys.generateDataKey('report-kek');
    expect(dek.plaintext).toHaveLength(32);
    expect(dek.wrapped).toMatch(/^vault:v\d+:/);
    expect((await keys.decryptDataKey('report-kek', dek.wrapped)).equals(dek.plaintext)).toBe(true);
  });

  it('cifra, decifra e recifra um valor pequeno (app-kek)', async () => {
    const value = Buffer.from('segredo-totp-de-exemplo');
    const ciphertext = await keys.encrypt('app-kek', value);
    expect((await keys.decrypt('app-kek', ciphertext)).equals(value)).toBe(true);
    const rewrapped = await keys.rewrap('app-kek', ciphertext);
    expect((await keys.decrypt('app-kek', rewrapped)).equals(value)).toBe(true);
  });

  it('o AppRole de dev da API funciona e não tem acesso à identity-kek no próprio Vault', async () => {
    const addr = process.env.VAULT_ADDR!;
    const auth = new VaultAuth({ addr, roleId: 'dev-api-role-id', secretId: 'dev-api-secret-id', timeoutMs: 2000 });
    const client = new VaultClient({ addr, auth, timeoutMs: 2000 });
    const dek = await client.generateDataKey('report-kek');
    expect(dek.plaintext).toHaveLength(32);

    const token = await auth.getToken();
    const res = await fetch(`${addr}/v1/transit/encrypt/identity-kek`, {
      method: 'POST',
      headers: { 'X-Vault-Token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ plaintext: Buffer.from('x').toString('base64') }),
    });
    expect(res.status).toBe(403);
  });
});
