import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.options.js';

/**
 * Usado só pela CLI do TypeORM (migration:generate / run / revert), sempre sobre o código compilado em dist/.
 * Conecta com o perfil app_migrator: DATABASE_MIGRATOR_URL no ambiente local,
 * ou DATABASE_URL no container de migrations.
 */
const databaseUrl = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Defina DATABASE_MIGRATOR_URL (ou DATABASE_URL) com as credenciais do app_migrator');
}

export default new DataSource({
  ...buildDataSourceOptions(databaseUrl, process.env.DATABASE_SSL === 'true'),
  migrations: [`${import.meta.dirname}/migrations/*.js`],
  migrationsTableName: 'typeorm_migrations',
});
