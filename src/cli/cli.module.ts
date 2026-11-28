import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.schema.js';
import { validateEnv } from '../config/env.validate.js';
import { buildDataSourceOptions } from '../database/database.options.js';
import { CliCommandsModule } from './cli-commands.module.js';

/**
 * Raiz da CLI: só configuração, banco e os comandos. Não sobe HTTP, filas nem storage.
 * Usa o mesmo perfil da API (`app_runtime`), via `DATABASE_URL`.
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
    CliCommandsModule,
  ],
})
export class CliModule {}
