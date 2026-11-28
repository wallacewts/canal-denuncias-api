import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { setupApp } from '../../src/app.setup.js';

/** FR-037: a documentação da API só existe fora de produção. */
async function appWith(nodeEnv: 'production' | 'development'): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => ({ NODE_ENV: nodeEnv, CORS_ORIGINS: [] })],
      }),
      LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  setupApp(app, { enableShutdownHooks: false });
  await app.init();
  return app;
}

describe('Documentação da API (e2e)', () => {
  it('/docs não existe com NODE_ENV=production', async () => {
    const app = await appWith('production');
    try {
      await request(app.getHttpServer()).get('/docs').expect(404);
    } finally {
      await app.close();
    }
  });

  it('/docs existe fora de produção', async () => {
    const app = await appWith('development');
    try {
      await request(app.getHttpServer()).get('/docs').expect(200);
    } finally {
      await app.close();
    }
  });
});
