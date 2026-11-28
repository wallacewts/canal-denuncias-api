import { PasswordHasher } from '@nestjs/authentication';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema.js';

/**
 * `PasswordHasher` (scrypt) do `@nestjs/authentication` (D32), criado por factory **sem** importar o
 * `AuthenticationModule`: o módulo registraria o guard global e exigiria stores, que são escopo da feature de auth.
 * O custo vem de `PASSWORD_HASH_LOG_N` (17 em produção; 10 só com NODE_ENV=test).
 */
export const passwordHasherProvider = {
  provide: PasswordHasher,
  inject: [ConfigService],
  useFactory: (config: Pick<ConfigService<Env, true>, 'get'>) =>
    new PasswordHasher({ logN: config.get('PASSWORD_HASH_LOG_N', { infer: true }) }),
};
