import { KeyServiceUnavailableError } from './key-service.errors.js';
import { VaultAuth } from './vault-auth.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function appRole(fetchImpl: typeof fetch, now: () => number) {
  return new VaultAuth({
    addr: 'http://vault:8200',
    roleId: 'role-id',
    secretId: 'secret-id',
    timeoutMs: 2000,
    fetchImpl,
    now,
  });
}

describe('VaultAuth', () => {
  it('modo token devolve o token sem chamar a rede', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const auth = new VaultAuth({ addr: 'http://vault:8200', token: 'dev-token', timeoutMs: 2000, fetchImpl });
    expect(await auth.getToken()).toBe('dev-token');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('AppRole faz login uma vez e reaproveita o token enquanto ele é válido', async () => {
    let clock = 0;
    const fetchImpl = vi.fn(async () =>
      json(200, { auth: { client_token: 't1', lease_duration: 300, renewable: true } }),
    ) as unknown as typeof fetch;
    const auth = appRole(fetchImpl, () => clock);
    expect(await auth.getToken()).toBe('t1');
    clock = 100_000; // 100 s: antes de 2/3 do TTL (200 s)
    expect(await auth.getToken()).toBe('t1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://vault:8200/v1/auth/approle/login');
    expect(JSON.parse(init.body as string)).toEqual({ role_id: 'role-id', secret_id: 'secret-id' });
  });

  it('renova o token quando 2/3 do TTL passaram', async () => {
    let clock = 0;
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/renew-self')
        ? json(200, { auth: { client_token: 't1', lease_duration: 300, renewable: true } })
        : json(200, { auth: { client_token: 't1', lease_duration: 300, renewable: true } }),
    ) as unknown as typeof fetch;
    const auth = appRole(fetchImpl, () => clock);
    await auth.getToken();
    clock = 201_000;
    expect(await auth.getToken()).toBe('t1');
    const urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(urls).toEqual(['http://vault:8200/v1/auth/approle/login', 'http://vault:8200/v1/auth/token/renew-self']);
  });

  it('faz novo login se a renovação falhar', async () => {
    let clock = 0;
    let logins = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/renew-self')) return json(403, { errors: ['permission denied'] });
      logins += 1;
      return json(200, { auth: { client_token: `t${logins}`, lease_duration: 300, renewable: true } });
    }) as unknown as typeof fetch;
    const auth = appRole(fetchImpl, () => clock);
    expect(await auth.getToken()).toBe('t1');
    clock = 250_000;
    expect(await auth.getToken()).toBe('t2');
  });

  it('chamadas simultâneas compartilham um único login', async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { auth: { client_token: 't1', lease_duration: 300, renewable: true } }),
    ) as unknown as typeof fetch;
    const auth = appRole(fetchImpl, () => 0);
    await Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('login com Vault fora do ar vira KeyServiceUnavailableError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(appRole(fetchImpl, () => 0).getToken()).rejects.toBeInstanceOf(KeyServiceUnavailableError);
  });
});
