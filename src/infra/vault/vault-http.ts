import { KeyServiceRequestError, KeyServiceUnavailableError } from './key-service.errors.js';

export interface VaultHttpOptions {
  addr: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * Única função que fala HTTP com o Vault. Converte qualquer falha num erro próprio do projeto, sem copiar o corpo da
 * requisição (plaintext, chave) nem o da resposta, que pode ecoar o ciphertext (FR-015).
 */
export async function vaultRequest<T>(
  options: VaultHttpOptions,
  path: string,
  /** `null` faz um GET (leitura de metadados, ex.: `transit/keys/:kek`). */
  body: Record<string, unknown> | null,
  token?: string,
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = body === null ? {} : { 'content-type': 'application/json' };
  if (token) headers['X-Vault-Token'] = token;

  let response: Response;
  try {
    response = await fetchImpl(`${options.addr.replace(/\/$/, '')}/v1/${path}`, {
      method: body === null ? 'GET' : 'POST',
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    throw new KeyServiceUnavailableError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable');
  }

  if (response.status === 503) throw new KeyServiceUnavailableError('sealed');
  if (response.status >= 500) throw new KeyServiceUnavailableError('server-error');
  if (!response.ok) throw new KeyServiceRequestError(response.status);

  try {
    return (await response.json()) as T;
  } catch {
    throw new KeyServiceRequestError(response.status);
  }
}
