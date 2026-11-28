import { KeyServiceRequestError, KeyServiceUnavailableError } from './key-service.errors.js';
import { VaultAuth } from './vault-auth.js';
import { VaultClient } from './vault.client.js';

const SEGREDO = Buffer.from('PLAINTEXT-SECRETO-DA-DENUNCIA');
const WRAPPED = 'vault:v1:CIPHERTEXT-QUE-NAO-PODE-VAZAR';
const TOKEN = 'hvs.TOKEN-QUE-NAO-PODE-VAZAR';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function client(fetchImpl: typeof fetch, timeoutMs = 2000) {
  const auth = new VaultAuth({ addr: 'http://vault:8200', token: TOKEN, timeoutMs, fetchImpl });
  return new VaultClient({ addr: 'http://vault:8200', timeoutMs, auth, fetchImpl });
}

/** Tudo que um erro expõe: mensagem, propriedades enumeráveis e serialização. */
function exposed(error: unknown): string {
  const e = error as Error;
  return [e.message, e.stack, JSON.stringify(e), JSON.stringify(Object.entries(e))].join('\n');
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('deveria ter falhado');
}

describe('VaultClient', () => {
  it('gera chave de dados devolvendo plaintext em Buffer e a versão protegida', async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { data: { plaintext: SEGREDO.toString('base64'), ciphertext: WRAPPED } }),
    ) as unknown as typeof fetch;
    const dek = await client(fetchImpl).generateDataKey('report-kek');
    expect(dek.plaintext.equals(SEGREDO)).toBe(true);
    expect(dek.wrapped).toBe(WRAPPED);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://vault:8200/v1/transit/datakey/plaintext/report-kek');
    expect((init.headers as Record<string, string>)['X-Vault-Token']).toBe(TOKEN);
  });

  it('cifra e decifra com app-kek trocando base64 com o Vault', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/encrypt/app-kek')) {
        expect(JSON.parse(init.body as string)).toEqual({ plaintext: SEGREDO.toString('base64') });
        return json(200, { data: { ciphertext: WRAPPED } });
      }
      return json(200, { data: { plaintext: SEGREDO.toString('base64') } });
    }) as unknown as typeof fetch;
    const c = client(fetchImpl);
    expect(await c.encrypt('app-kek', SEGREDO)).toBe(WRAPPED);
    expect((await c.decrypt('app-kek', WRAPPED)).equals(SEGREDO)).toBe(true);
  });

  it('recusa a identity-kek antes de qualquer chamada de rede (D24)', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const c = client(fetchImpl);
    for (const call of [
      () => c.generateDataKey('identity-kek' as never),
      () => c.decryptDataKey('identity-kek' as never, WRAPPED),
      () => c.encrypt('identity-kek' as never, SEGREDO),
      () => c.decrypt('identity-kek' as never, WRAPPED),
      () => c.rewrap('identity-kek' as never, WRAPPED),
    ]) {
      await expect(call()).rejects.toThrow(/identity-kek/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('timeout vira KeyServiceUnavailableError dentro do prazo configurado', async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const started = Date.now();
    const error = await caught(client(fetchImpl, 100).generateDataKey('report-kek'));
    expect(error).toBeInstanceOf(KeyServiceUnavailableError);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('Vault selado (503) vira KeyServiceUnavailableError', async () => {
    const fetchImpl = vi.fn(async () => json(503, { errors: ['Vault is sealed'] })) as unknown as typeof fetch;
    expect(await caught(client(fetchImpl).generateDataKey('report-kek'))).toBeInstanceOf(KeyServiceUnavailableError);
  });

  it('Vault fora do ar (conexão recusada) vira KeyServiceUnavailableError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await caught(client(fetchImpl).decrypt('report-kek', WRAPPED))).toBeInstanceOf(KeyServiceUnavailableError);
  });

  it('erros nunca expõem plaintext, ciphertext, token nem o corpo devolvido pelo Vault', async () => {
    const echo = vi.fn(async () =>
      json(400, { errors: [`invalid ciphertext ${WRAPPED} plaintext ${SEGREDO.toString('base64')}`] }),
    ) as unknown as typeof fetch;
    const c = client(echo);
    for (const promise of [
      c.encrypt('app-kek', SEGREDO),
      c.decrypt('report-kek', WRAPPED),
      c.rewrap('app-kek', WRAPPED),
    ]) {
      const error = await caught(promise);
      expect(error).toBeInstanceOf(KeyServiceRequestError);
      const text = exposed(error);
      expect(text).not.toContain('CIPHERTEXT-QUE-NAO-PODE-VAZAR');
      expect(text).not.toContain(SEGREDO.toString('base64'));
      expect(text).not.toContain('PLAINTEXT-SECRETO');
      expect(text).not.toContain('TOKEN-QUE-NAO-PODE-VAZAR');
    }
  });

  it('Vault volta ao ar: depois de uma falha, a próxima chamada funciona sem recriar o cliente', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return json(200, { data: { plaintext: SEGREDO.toString('base64') } });
    }) as unknown as typeof fetch;
    const c = client(fetchImpl);
    expect(await caught(c.decrypt('report-kek', WRAPPED))).toBeInstanceOf(KeyServiceUnavailableError);
    expect((await c.decrypt('report-kek', WRAPPED)).equals(SEGREDO)).toBe(true);
  });

  it('token AppRole revogado ou expirado no meio da operação: novo login e uma nova tentativa', async () => {
    let logins = 0;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/approle/login')) {
        logins += 1;
        return json(200, { auth: { client_token: `t${logins}`, lease_duration: 3600, renewable: true } });
      }
      const token = (init.headers as Record<string, string>)['X-Vault-Token'];
      return token === 't1'
        ? json(403, { errors: ['permission denied'] })
        : json(200, { data: { ciphertext: WRAPPED } });
    }) as unknown as typeof fetch;
    const auth = new VaultAuth({ addr: 'http://vault:8200', roleId: 'r', secretId: 's', timeoutMs: 2000, fetchImpl });
    const c = new VaultClient({ addr: 'http://vault:8200', timeoutMs: 2000, auth, fetchImpl });
    expect(await c.encrypt('app-kek', SEGREDO)).toBe(WRAPPED);
    expect(logins).toBe(2);
  });
});
