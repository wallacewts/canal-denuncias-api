import request from 'supertest';
import { DataSource } from 'typeorm';
import { withRole } from './support/db-roles.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const monthName = (offset: number): string => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return `audit_logs_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

describe('Health checks e harness de testes (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('GET /health responde sem tocar no banco', async () => {
    const res = await request(t.app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /ready confirma o banco', async () => {
    const res = await request(t.app.getHttpServer()).get('/ready').expect(200);
    expect(res.body.details.database.status).toBe('up');
  });

  it('roda contra o banco exclusivo da suíte, com o perfil app_runtime e as migrations aplicadas', async () => {
    const dataSource = t.app.get(DataSource);
    const [row] = await dataSource.query<Array<{ db: string; usr: string; categories: number }>>(
      `SELECT current_database() AS db, current_user AS usr, (SELECT count(*)::int FROM categories) AS categories`,
    );
    expect(row).toEqual({ db: t.database.name, usr: 'app_runtime', categories: 3 });
  });

  it('captura as linhas de log da requisição, sem IP nem cabeçalhos', async () => {
    await request(t.app.getHttpServer())
      .get('/api/rota-inexistente?protocol=DV-SEGREDO')
      .set('X-Forwarded-For', '203.0.113.9')
      .set('User-Agent', 'Navegador-De-Teste/1.0')
      .expect(404);

    const line = t.logs.lines().find((l) => l.req?.path === '/api/rota-inexistente');
    expect(line?.req?.id).toEqual(expect.any(String));
    expect(t.logs.forRequest(line!.req!.id!).length).toBeGreaterThan(0);

    const text = t.logs.text();
    expect(text).not.toContain('203.0.113.9');
    expect(text).not.toContain('Navegador-De-Teste');
    expect(text).not.toContain('DV-SEGREDO');
  });

  describe('partições da trilha à frente (US7)', () => {
    it('com partições suficientes, /ready informa os meses à frente sem aviso', async () => {
      const res = await request(t.app.getHttpServer()).get('/ready').expect(200);
      expect(res.body.details.auditPartitions).toEqual(expect.objectContaining({ status: 'up' }));
      expect(res.body.details.auditPartitions.warning).toBeUndefined();
    });

    it('com menos de 1 mês à frente, /ready continua 200 com aviso', async () => {
      await withRole(t.database, 'superuser', async (c) => {
        for (let offset = 2; offset <= 12; offset++) await c.query(`DROP TABLE IF EXISTS ${monthName(offset)}`);
      });
      const res = await request(t.app.getHttpServer()).get('/ready').expect(200);
      expect(res.body.details.auditPartitions).toEqual(
        expect.objectContaining({ status: 'up', monthsAhead: 1, warning: expect.any(String) }),
      );
    });

    it('sem a partição do mês seguinte, /ready responde 503', async () => {
      await withRole(t.database, 'superuser', (c) => c.query(`DROP TABLE IF EXISTS ${monthName(1)}`));
      // O 503 sai no formato único de erro da API (filtro global), sem detalhes internos.
      const res = await request(t.app.getHttpServer()).get('/ready').expect(503);
      expect(res.body.statusCode).toBe(503);
    });
  });
});
