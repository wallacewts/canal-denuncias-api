import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { PublicFixtureModule } from '../../support/fixtures/public-fixture.module.js';
import { createTestApp, type TestApp } from '../../support/test-app.js';

/**
 * Área pública com os guards de autenticação e autorização globais (T007, R4, princípio I): continua aberta, não lê
 * nem emite cookie de sessão, ignora credenciais e nunca vira identidade. Health e ready seguem abertos.
 */
describe('Área pública com autenticação global (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;

  beforeAll(async () => {
    t = await createTestApp({ imports: [PublicFixtureModule] });
    ds = t.app.get<DataSource>(getDataSourceToken());
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('rota pública responde sem sessão e sem emitir cookie de sessão', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/public/v1/fixtures/cookie').expect(200);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.some((c) => c.includes('sid='))).toBe(false);
    expect(cookies).toHaveLength(0);
  });

  it.each([
    ['Cookie', '__Host-sid=XQZ'],
    ['Cookie', `__Host-sid=${'a'.repeat(43)}`],
    ['Authorization', 'Bearer XQZ'],
  ])('credencial enviada (%s) é ignorada na área pública: nada de 401', async (header, value) => {
    await request(t.app.getHttpServer())
      .get('/api/public/v1/fixtures/attachments/01900000-0000-7000-8000-000000000000')
      .set(header, value)
      .expect(200);
  });

  it('/health e /ready continuam abertos', async () => {
    await request(t.app.getHttpServer()).get('/health').expect(200);
    await request(t.app.getHttpServer()).get('/ready').expect(200);
  });

  it('a área administrativa continua 401 sem sessão', async () => {
    await request(t.app.getHttpServer()).get('/api/admin/v1/fixtures/sensitive').expect(401);
  });

  it('nenhuma sessão foi criada pelo tráfego público', async () => {
    const rows = (await ds.query(`SELECT count(*)::int AS n FROM sessions`)) as Array<{ n: number }>;
    expect(rows[0].n).toBe(0);
  });
});
