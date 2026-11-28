import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { KEY_SERVICE } from './key-service.js';
import { VaultAuth } from './vault-auth.js';
import { VaultClient } from './vault.client.js';

/**
 * Acesso ao serviço de chaves (TRV-04). Não fala com o Vault na inicialização: a primeira chamada autentica.
 * Assim a API sobe mesmo com o Vault fora do ar e responde 503 só nas rotas que dependem dele.
 */
@Module({
  providers: [
    {
      provide: VaultAuth,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new VaultAuth({
          addr: config.get('VAULT_ADDR', { infer: true }),
          timeoutMs: config.get('VAULT_TIMEOUT_MS', { infer: true }),
          token: config.get('VAULT_TOKEN', { infer: true }),
          roleId: config.get('VAULT_ROLE_ID', { infer: true }),
          secretId: config.get('VAULT_SECRET_ID', { infer: true }),
        }),
    },
    {
      provide: KEY_SERVICE,
      inject: [ConfigService, VaultAuth],
      useFactory: (config: ConfigService<Env, true>, auth: VaultAuth) =>
        new VaultClient({
          addr: config.get('VAULT_ADDR', { infer: true }),
          timeoutMs: config.get('VAULT_TIMEOUT_MS', { infer: true }),
          auth,
        }),
    },
  ],
  exports: [KEY_SERVICE],
})
export class VaultModule {}
