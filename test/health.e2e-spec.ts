import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';

/** Precisa do Postgres com as migrations aplicadas (docker compose up -d && npm run migration:run). */
describe('Health checks (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health responde sem tocar no banco', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
      });
  });

  it('GET /ready confirma o banco', () => {
    return request(app.getHttpServer())
      .get('/ready')
      .expect(200)
      .expect((res) => {
        expect(res.body.details.database.status).toBe('up');
      });
  });
});
