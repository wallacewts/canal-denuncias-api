import type { DynamicModule, INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { setupApp } from '../../src/app.setup.js';
import { LOG_DESTINATION } from '../../src/config/log-destination.js';
import { AUTH_IDENTITY } from '../../src/infra/auth/auth-identity.port.js';
import { FakeIdentity, TestIdentityModule } from './fake-identity.js';
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
  /** Substitui providers (ex.: um prompt de senha falso nos testes da CLI). */
  overrides?: Array<{ provide: unknown; useValue: unknown }>;
  /**
   * Credencial do Vault da API nesta suíte. `root` (padrão) usa o token de desenvolvimento; `api` e `maintenance` usam
   * os AppRoles de dev, para provar que as políticas reais bastam (G1 da feature 002).
   */
  vault?: 'root' | 'api' | 'maintenance';
  /**
   * Liga a identidade só de teste (`fake-identity.ts`): a área admin reconhece o cabeçalho `x-test-identity`. Sem
   * esta opção, vale a porta padrão e toda rota admin responde 401, como em produção até a AUTH-06.
   */
  identity?: boolean;
  /** Reaproveita o banco de outra suíte (simula reiniciar a API); o `close()` não o apaga. */
  database?: SuiteDatabase;
}

const APPROLES = {
  api: { roleId: 'dev-api-role-id', secretId: 'dev-api-secret-id' },
  maintenance: { roleId: 'dev-maintenance-role-id', secretId: 'dev-maintenance-secret-id' },
} as const;

/**
 * Sobe a API como em produção (`setupApp`), contra um banco só da suíte e com os logs capturados em memória.
 * Use um app por arquivo de teste (beforeAll/afterAll).
 */
export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  loadLocalEnv();
  applyTestEnv();

  const database = options.database ?? (await createSuiteDatabase());
  // O ConfigModule lê o ambiente ao importar o AppModule. O Vitest isola cada arquivo de teste,
  // então o import dinâmico abaixo enxerga a URL do banco desta suíte.
  process.env.DATABASE_URL = database.runtimeUrl;
  if (options.vault && options.vault !== 'root') {
    delete process.env.VAULT_TOKEN;
    process.env.VAULT_ROLE_ID = APPROLES[options.vault].roleId;
    process.env.VAULT_SECRET_ID = APPROLES[options.vault].secretId;
  }
  const { AppModule } = await import('../../src/app.module.js');

  const logs = new LogCapture();
  const imports = [AppModule, ...(options.identity ? [TestIdentityModule] : []), ...(options.imports ?? [])];
  let builder = Test.createTestingModule({ imports }).overrideProvider(LOG_DESTINATION).useValue(logs);
  if (options.identity) builder = builder.overrideProvider(AUTH_IDENTITY).useValue(new FakeIdentity());
  for (const { provide, useValue } of options.overrides ?? []) {
    builder = builder.overrideProvider(provide).useValue(useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  setupApp(app, { enableShutdownHooks: false });
  await app.init();

  return {
    app,
    logs,
    database,
    close: async () => {
      await app.close();
      if (!options.database) await database.drop();
    },
  };
}
