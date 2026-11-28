import { vaultRequest, type VaultHttpOptions } from './vault-http.js';

export interface VaultAuthOptions extends VaultHttpOptions {
  /** Só fora de produção (o schema de ambiente recusa token em produção). */
  token?: string;
  roleId?: string;
  secretId?: string;
  /** Relógio injetável, para os testes de renovação. */
  now?: () => number;
}

interface AuthResponse {
  auth: { client_token: string; lease_duration: number; renewable: boolean };
}

interface Lease {
  token: string;
  renewAt: number;
  expiresAt: number;
}

/**
 * Credencial do Vault: token fixo em desenvolvimento ou AppRole em produção. No AppRole, o token é renovado quando
 * 2/3 do TTL passam, e um novo login é feito se a renovação falhar (FR-013).
 */
export class VaultAuth {
  private lease?: Lease;
  private pending?: Promise<string>;
  private readonly now: () => number;

  constructor(private readonly options: VaultAuthOptions) {
    this.now = options.now ?? Date.now;
    if (!options.token && !(options.roleId && options.secretId)) {
      throw new Error('VaultAuth precisa de VAULT_TOKEN ou de VAULT_ROLE_ID e VAULT_SECRET_ID');
    }
  }

  async getToken(): Promise<string> {
    if (this.options.token) return this.options.token;

    const now = this.now();
    if (this.lease && now < this.lease.renewAt) return this.lease.token;

    // Uma única renovação ou login em andamento, compartilhado por chamadas simultâneas.
    this.pending ??= this.refresh(now).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  /** Descarta o token atual (ex.: depois de um 403 inesperado), forçando novo login na próxima chamada. */
  invalidate(): void {
    this.lease = undefined;
  }

  private async refresh(now: number): Promise<string> {
    if (this.lease && now < this.lease.expiresAt) {
      try {
        const renewed = await vaultRequest<AuthResponse>(this.options, 'auth/token/renew-self', {}, this.lease.token);
        return this.store(renewed);
      } catch {
        // Renovação recusada ou token revogado: segue para um novo login.
      }
    }
    const login = await vaultRequest<AuthResponse>(this.options, 'auth/approle/login', {
      role_id: this.options.roleId,
      secret_id: this.options.secretId,
    });
    return this.store(login);
  }

  private store(response: AuthResponse): string {
    const issuedAt = this.now();
    const ttlMs = response.auth.lease_duration * 1000;
    this.lease = {
      token: response.auth.client_token,
      renewAt: issuedAt + Math.floor((ttlMs * 2) / 3),
      expiresAt: issuedAt + ttlMs,
    };
    return this.lease.token;
  }
}
