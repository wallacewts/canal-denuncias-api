import { readFile } from 'node:fs/promises';
import { vaultAdmin } from '../support/vault-admin.js';
import { acquireKekRotationLock } from '../support/kek-lock.js';

type Profile = 'api' | 'maintenance' | 'identity-worker';

const POLICY_DIR = new URL('../../docs/deploy/vault/policies/', import.meta.url);
const DEV_DIR = new URL('../../docker/vault/', import.meta.url);

/** Lê os blocos `path "..." { capabilities = [...] }` de um arquivo HCL de política. */
function capabilities(hcl: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of hcl.matchAll(/path\s+"([^"]+)"\s*\{\s*capabilities\s*=\s*\[([^\]]*)\]\s*\}/g)) {
    out[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((c) => c[1]).sort();
  }
  return out;
}

/** CRYPTO-07 / SC-006: as políticas de produção, aplicadas ao Vault local, permitem e recusam o que o contrato diz. */
describe('Políticas do Vault de produção (e2e)', () => {
  /** Serializa com as outras suítes que giram a report-kek (pendência F1). */
  let kekLock: { release(): Promise<void> };
  const tokens = {} as Record<Profile, string>;
  let reportCt: string;
  let appCt: string;
  let identityCt: string;

  beforeAll(async () => {
    kekLock = await acquireKekRotationLock();
    for (const profile of ['api', 'maintenance', 'identity-worker'] as Profile[]) {
      const policy = await readFile(new URL(`${profile}.hcl`, POLICY_DIR), 'utf8');
      const name = `test-prod-${profile}`;
      expect((await vaultAdmin('PUT', `sys/policies/acl/${name}`, { policy })).status).toBe(204);
      const { data } = await vaultAdmin<{ auth: { client_token: string } }>('POST', 'auth/token/create', {
        policies: [name],
        no_default_policy: true,
        ttl: '10m',
      });
      tokens[profile] = data.auth.client_token;
    }
    const dk = await vaultAdmin<{ data: { ciphertext: string } }>('POST', 'transit/datakey/plaintext/report-kek');
    reportCt = dk.data.data.ciphertext;
    appCt = (
      await vaultAdmin<{ data: { ciphertext: string } }>('POST', 'transit/encrypt/app-kek', { plaintext: 'WFFa' })
    ).data.data.ciphertext;
    identityCt = (await vaultAdmin<{ data: { ciphertext: string } }>('POST', 'transit/datakey/plaintext/identity-kek'))
      .data.data.ciphertext;
  });

  afterAll(async () => {
    await kekLock?.release();
  });

  const call = (profile: Profile, method: 'GET' | 'POST', path: string, body?: unknown) =>
    vaultAdmin(method, path, body, tokens[profile]).then((r) => r.status);

  const cells: Array<[string, 'GET' | 'POST', string, () => unknown, Record<Profile, 200 | 403>]> = [
    [
      'datakey report-kek',
      'POST',
      'transit/datakey/plaintext/report-kek',
      () => ({}),
      { api: 200, maintenance: 403, 'identity-worker': 403 },
    ],
    [
      'decrypt report-kek',
      'POST',
      'transit/decrypt/report-kek',
      () => ({ ciphertext: reportCt }),
      { api: 200, maintenance: 403, 'identity-worker': 403 },
    ],
    [
      'rewrap report-kek',
      'POST',
      'transit/rewrap/report-kek',
      () => ({ ciphertext: reportCt }),
      { api: 403, maintenance: 200, 'identity-worker': 403 },
    ],
    [
      'read keys/report-kek',
      'GET',
      'transit/keys/report-kek',
      () => undefined,
      { api: 403, maintenance: 200, 'identity-worker': 403 },
    ],
    [
      'encrypt app-kek',
      'POST',
      'transit/encrypt/app-kek',
      () => ({ plaintext: 'WFFa' }),
      { api: 200, maintenance: 403, 'identity-worker': 403 },
    ],
    [
      'decrypt app-kek',
      'POST',
      'transit/decrypt/app-kek',
      () => ({ ciphertext: appCt }),
      { api: 200, maintenance: 403, 'identity-worker': 403 },
    ],
    [
      'datakey identity-kek',
      'POST',
      'transit/datakey/plaintext/identity-kek',
      () => ({}),
      { api: 403, maintenance: 403, 'identity-worker': 200 },
    ],
    [
      'decrypt identity-kek',
      'POST',
      'transit/decrypt/identity-kek',
      () => ({ ciphertext: identityCt }),
      { api: 403, maintenance: 403, 'identity-worker': 200 },
    ],
    [
      'encrypt identity-kek',
      'POST',
      'transit/encrypt/identity-kek',
      () => ({ plaintext: 'WFFa' }),
      { api: 403, maintenance: 403, 'identity-worker': 403 },
    ],
    [
      'rotate report-kek',
      'POST',
      'transit/keys/report-kek/rotate',
      () => ({}),
      { api: 403, maintenance: 403, 'identity-worker': 403 },
    ],
    [
      'listar políticas',
      'GET',
      'sys/policies/acl?list=true',
      () => undefined,
      { api: 403, maintenance: 403, 'identity-worker': 403 },
    ],
  ];

  describe.each(cells)('%s', (_nome, method, path, body, expected) => {
    it.each(Object.entries(expected) as Array<[Profile, number]>)('%s → %i', async (profile, status) => {
      expect(await call(profile, method, path, body())).toBe(status);
    });
  });

  it.each([
    ['api-dev-policy.hcl', 'api.hcl'],
    ['maintenance-dev-policy.hcl', 'maintenance.hcl'],
  ])('a política de desenvolvimento %s concede exatamente o mesmo que %s', async (dev, prod) => {
    const devCaps = capabilities(await readFile(new URL(dev, DEV_DIR), 'utf8'));
    const prodCaps = capabilities(await readFile(new URL(prod, POLICY_DIR), 'utf8'));
    expect(Object.keys(prodCaps).length).toBeGreaterThan(0);
    expect(devCaps).toEqual(prodCaps);
  });
});
