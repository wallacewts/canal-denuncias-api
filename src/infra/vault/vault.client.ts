import { ALLOWED_KEKS, type AllowedKek, type DataKey, type KeyService, type TransitOptions } from './key-service.js';
import { KeyServiceRequestError } from './key-service.errors.js';
import type { VaultAuth } from './vault-auth.js';
import { vaultRequest, type VaultHttpOptions } from './vault-http.js';

export interface VaultClientOptions extends VaultHttpOptions {
  auth: VaultAuth;
}

interface TransitData<T> {
  data: T;
}

/**
 * Cliente próprio do Vault Transit (D28). Só as operações que o projeto usa, com timeout em toda chamada e uma
 * allowlist que recusa a `identity-kek` antes de qualquer chamada de rede (D24).
 */
export class VaultClient implements KeyService {
  constructor(private readonly options: VaultClientOptions) {}

  async generateDataKey(kek: AllowedKek): Promise<DataKey> {
    const res = await this.call<{ plaintext: string; ciphertext: string }>(kek, `transit/datakey/plaintext/${kek}`, {});
    return { plaintext: Buffer.from(res.plaintext, 'base64'), wrapped: res.ciphertext };
  }

  async decryptDataKey(kek: AllowedKek, wrapped: string): Promise<Buffer> {
    return this.decrypt(kek, wrapped);
  }

  async encrypt(kek: AllowedKek, plaintext: Buffer, options?: TransitOptions): Promise<string> {
    const res = await this.call<{ ciphertext: string }>(kek, `transit/encrypt/${kek}`, {
      plaintext: plaintext.toString('base64'),
      ...associatedData(options),
    });
    return res.ciphertext;
  }

  async decrypt(kek: AllowedKek, ciphertext: string, options?: TransitOptions): Promise<Buffer> {
    const res = await this.call<{ plaintext: string }>(kek, `transit/decrypt/${kek}`, {
      ciphertext,
      ...associatedData(options),
    });
    return Buffer.from(res.plaintext, 'base64');
  }

  async rewrap(kek: AllowedKek, ciphertext: string): Promise<string> {
    const res = await this.call<{ ciphertext: string }>(kek, `transit/rewrap/${kek}`, { ciphertext });
    return res.ciphertext;
  }

  async latestVersion(kek: AllowedKek): Promise<number> {
    const res = await this.call<{ latest_version: number }>(kek, `transit/keys/${kek}`, null);
    return res.latest_version;
  }

  private async call<T>(kek: AllowedKek, path: string, body: Record<string, unknown> | null): Promise<T> {
    if (!(ALLOWED_KEKS as readonly string[]).includes(kek)) {
      throw new Error(`A API não pode usar a chave '${String(kek)}' (permitidas: ${ALLOWED_KEKS.join(', ')})`);
    }
    try {
      return await this.send<T>(path, body);
    } catch (error) {
      // 403 com token de AppRole: token revogado ou expirado. Tenta uma vez com um token novo.
      if (error instanceof KeyServiceRequestError && error.vaultStatus === 403) {
        this.options.auth.invalidate();
        return this.send<T>(path, body);
      }
      throw error;
    }
  }

  private async send<T>(path: string, body: Record<string, unknown> | null): Promise<T> {
    const token = await this.options.auth.getToken();
    const res = await vaultRequest<TransitData<T>>(this.options, path, body, token);
    return res.data;
  }
}

function associatedData(options?: TransitOptions): { associated_data?: string } {
  return options?.associatedData ? { associated_data: options.associatedData.toString('base64') } : {};
}
