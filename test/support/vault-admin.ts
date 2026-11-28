/**
 * Operações administrativas do Vault de desenvolvimento, só para os testes (girar chave, gravar política, criar token).
 * Usa o token root de dev diretamente por HTTP; nunca é usado pelo código da aplicação.
 */
const ROOT_TOKEN = 'dev-root-token';

function addr(): string {
  return (process.env.VAULT_ADDR ?? 'http://localhost:8200').replace(/\/$/, '');
}

export async function vaultAdmin<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  token = ROOT_TOKEN,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${addr()}/v1/${path}`, {
    method,
    headers: { 'X-Vault-Token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : {}) as T };
}

/** Gira a KEK no Vault de dev e devolve a nova versão. */
export async function rotateKek(kek: 'report-kek' | 'app-kek'): Promise<number> {
  await vaultAdmin('POST', `transit/keys/${kek}/rotate`);
  const { data } = await vaultAdmin<{ data: { latest_version: number } }>('GET', `transit/keys/${kek}`);
  return data.data.latest_version;
}
