import type { DynamicModule, INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { setupApp } from '../../src/app.setup.js';
import { LOG_DESTINATION } from '../../src/config/log-destination.js';
import { loadLocalEnv } from './db-urls.js';
import { LogCapture } from './log-capture.js';
import { createSuiteDatabase, type SuiteDatabase } from './test-database.js';
import { applyTestEnv } from './test-env.js';

export interface TestApp {
  app: INestApplication;
  /** Linhas de log de toda a suíte. */
  logs: LogCapture;
  database: SuiteDatabase;
  close(): Promise<void>;
}

export interface CreateTestAppOptions {
  /** Módulos de fixture (rotas só de teste) importados junto com o AppModule. */
  imports?: Array<Type<unknown> | DynamicModule>;
}

/**
 * Sobe a API como em produção (`setupApp`), contra um banco só da suíte e com os logs capturados em memória.
 * Use um app por arquivo de teste (beforeAll/afterAll).
 */
export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  loadLocalEnv();
  applyTestEnv();

  const database = await createSuiteDatabase();
  // O ConfigModule lê o ambiente ao importar o AppModule. O Vitest isola cada arquivo de teste,
  // então o import dinâmico abaixo enxerga a URL do banco desta suíte.
  process.env.DATABASE_URL = database.runtimeUrl;
  const { AppModule } = await import('../../src/app.module.js');

  const logs = new LogCapture();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ...(options.imports ?? [])] })
    .overrideProvider(LOG_DESTINATION)
    .useValue(logs)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  setupApp(app, { enableShutdownHooks: false });
  await app.init();

  return {
    app,
    logs,
    database,
    close: async () => {
      await app.close();
      await database.drop();
    },
  };
}
