/** KEKs que a API pode usar. A `identity-kek` fica de fora: só o identity-worker isolado a usa (D24). */
export const ALLOWED_KEKS = ['report-kek', 'app-kek'] as const;
export type AllowedKek = (typeof ALLOWED_KEKS)[number];

export interface DataKey {
  /** 32 bytes, só em memória. Quem usa deve zerar o buffer depois (`plaintext.fill(0)`). */
  plaintext: Buffer;
  /** Versão protegida pelo Vault (`vault:vN:...`), para guardar no banco. */
  wrapped: string;
}

/** Contrato do serviço de chaves (contracts/key-service.md). */
export interface KeyService {
  generateDataKey(kek: AllowedKek): Promise<DataKey>;
  decryptDataKey(kek: AllowedKek, wrapped: string): Promise<Buffer>;
  encrypt(kek: AllowedKek, plaintext: Buffer): Promise<string>;
  decrypt(kek: AllowedKek, ciphertext: string): Promise<Buffer>;
  rewrap(kek: AllowedKek, ciphertext: string): Promise<string>;
}

export const KEY_SERVICE = Symbol('KEY_SERVICE');
