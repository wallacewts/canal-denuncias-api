import { Inject, Injectable } from '@nestjs/common';
import { KEY_SERVICE, type KeyService } from '../../infra/vault/key-service.js';
import type { EncryptedField, EncryptionContext } from './encryption-context.js';

/** Campos cifrados direto no Vault com a `app-kek` (dado pequeno; a chave nunca sai do Vault). */
const APP_SECRET_FIELDS: readonly EncryptedField[] = ['users.mfa_secret_enc', 'users.mfa_pending_secret_enc'];

/**
 * Segredos da aplicação (CRYPTO-05, D42): cifrados no Vault com `associated_data` igual ao contexto do registro, para
 * que o segredo de um usuário não abra se for copiado para outro. Quem recebe o Buffer de `open` deve zerá-lo.
 */
@Injectable()
export class AppSecretService {
  constructor(@Inject(KEY_SERVICE) private readonly keys: KeyService) {}

  async seal(ctx: EncryptionContext, secret: Buffer): Promise<string> {
    assertAppSecret(ctx);
    return this.keys.encrypt('app-kek', secret, { associatedData: ctx.aad });
  }

  async open(ctx: EncryptionContext, value: string): Promise<Buffer> {
    assertAppSecret(ctx);
    return this.keys.decrypt('app-kek', value, { associatedData: ctx.aad });
  }
}

function assertAppSecret(ctx: EncryptionContext): void {
  if (!APP_SECRET_FIELDS.includes(ctx.field)) throw new Error('Campo não é um segredo da aplicação');
}
