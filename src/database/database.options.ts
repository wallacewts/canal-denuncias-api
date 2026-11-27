import type { DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities.js';
import { SnakeNamingStrategy } from './snake-naming.strategy.js';

/** Opções compartilhadas entre a API (TypeOrmModule) e a CLI do TypeORM (data-source.ts). */
export function buildDataSourceOptions(databaseUrl: string, ssl: boolean): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    ssl: ssl ? { rejectUnauthorized: true } : false,
    entities: ENTITIES,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false, // nunca true: as mudanças de schema passam sempre por migration revisada
    migrationsRun: false, // migrations rodam num passo separado do deploy, com o perfil app_migrator
    logging: ['error', 'warn'],
  };
}
