import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.schema.js';
import { validateEnv } from '../config/env.validate.js';
import { buildDataSourceOptions } from '../database/database.options.js';
import { AuthInfraModule } from '../infra/auth/auth-infra.module.js';
import { CliCommandsModule } from './cli-commands.module.js';

/**
 * Raiz da CLI: só configuração, banco, autenticação (sessões, MFA e hash, que o `UsersService` usa) e os comandos.
 * Não sobe HTTP, filas nem storage. Usa o mesmo perfil da API (`app_runtime`), via `DATABASE_URL`.
 * O teste `test/cli/cli-module.e2e-spec.ts` monta este módulo de verdade: os testes dos comandos usam o `AppModule` e
 * não pegariam uma dependência que só a API fornece.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildDataSourceOptions(
          config.get('DATABASE_URL', { infer: true }),
          config.get('DATABASE_SSL', { infer: true }),
        ),
    }),
    AuthInfraModule,
    CliCommandsModule,
  ],
})
export class CliModule {}
