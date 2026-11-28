/** KEKs que a API pode usar. A `identity-kek` fica de fora: só o identity-worker isolado a usa (D24). */
export const ALLOWED_KEKS = ['report-kek', 'app-kek'] as const;
export type AllowedKek = (typeof ALLOWED_KEKS)[number];

export interface DataKey {
  /** 32 bytes, só em memória. Quem usa deve zerar o buffer depois (`plaintext.fill(0)`). */
  plaintext: Buffer;
  /** Versão protegida pelo Vault (`vault:vN:...`), para guardar no banco. */
  wrapped: string;
}

/** Contrato do serviço de chaves (contracts/key-service.md da 001, estendido por key-service-v2.md da 002). */
export interface KeyService {
  generateDataKey(kek: AllowedKek): Promise<DataKey>;
  decryptDataKey(kek: AllowedKek, wrapped: string): Promise<Buffer>;
  encrypt(kek: AllowedKek, plaintext: Buffer, options?: TransitOptions): Promise<string>;
  decrypt(kek: AllowedKek, ciphertext: string, options?: TransitOptions): Promise<Buffer>;
  rewrap(kek: AllowedKek, ciphertext: string): Promise<string>;
  /** Versão atual da KEK (`latest_version`). Exige `read` na chave: só o perfil de manutenção tem (D43). */
  latestVersion(kek: AllowedKek): Promise<number>;
}

/** Opções de cifragem direta (contrato key-service-v2 da feature 002). */
export interface TransitOptions {
  /** Contexto autenticado (`associated_data`): a decifragem com outro contexto falha no Vault (D42). */
  associatedData?: Buffer;
}

export const KEY_SERVICE = Symbol('KEY_SERVICE');
