import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CreateAdminCommand } from '../../src/cli/create-admin.command.js';
import { loadLocalEnv } from '../support/db-urls.js';
import { createSuiteDatabase, type SuiteDatabase } from '../support/test-database.js';
import { applyTestEnv } from '../support/test-env.js';

/**
 * Monta a raiz real da CLI (`CliModule`), e não o `AppModule`: os testes dos comandos usam a API inteira e não
 * pegariam uma dependência que só ela fornece (regressão da feature 005: `UsersService` passou a precisar do
 * `SessionService` e o `create-admin` deixou de iniciar).
 */
describe('CliModule (e2e)', () => {
  let database: SuiteDatabase;
  let context: INestApplicationContext | undefined;

  beforeAll(async () => {
    loadLocalEnv();
    applyTestEnv();
    database = await createSuiteDatabase();
    process.env.DATABASE_URL = database.runtimeUrl;
  });

  afterAll(async () => {
    await context?.close();
    await database?.drop();
  });

  it('resolve todas as dependências dos comandos', async () => {
    const { CliModule } = await import('../../src/cli/cli.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [CliModule] }).compile();
    context = await moduleRef.init();
    expect(context.get(CreateAdminCommand)).toBeInstanceOf(CreateAdminCommand);
  });
});
