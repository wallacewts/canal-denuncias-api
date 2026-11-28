import request from 'supertest';
import { ErrorFixtureModule, RELATO_SECRETO } from '../support/fixtures/error-fixture.module.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

describe('Erros da API (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [ErrorFixtureModule] });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(() => t.logs.clear());

  it.each([
    ['bad-request', 400],
    ['unauthorized', 401],
    ['forbidden', 403],
    ['not-found', 404],
    ['unique', 409],
    ['fk', 409],
    ['check', 500],
    ['internal', 500],
  ])('%s responde %i no formato único, com requestId igual ao do log', async (kind, status) => {
    const res = await request(t.app.getHttpServer()).get(`/api/fixtures/errors/${kind}`).expect(status);

    expect(Object.keys(res.body).sort()).toEqual(['error', 'message', 'requestId', 'statusCode']);
    expect(res.body.statusCode).toBe(status);
    expect(t.logs.forRequest(res.body.requestId).length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain(RELATO_SECRETO);
    expect(JSON.stringify(res.body)).not.toContain('UQ_fixture_constraint');
  });

  it('o corpo enviado nunca aparece na resposta nem no log', async () => {
    const res = await request(t.app.getHttpServer())
      .post('/api/fixtures/errors/echo')
      .send({ description: RELATO_SECRETO })
      .expect(400);

    expect(JSON.stringify(res.body)).not.toContain(RELATO_SECRETO);
    expect(t.logs.text()).not.toContain(RELATO_SECRETO);
  });

  it('erro de banco não deixa parâmetros da query nem detalhes no log', async () => {
    await request(t.app.getHttpServer()).get('/api/fixtures/errors/unique').expect(409);
    await request(t.app.getHttpServer()).get('/api/fixtures/errors/check').expect(500);
    expect(t.logs.text()).not.toContain(RELATO_SECRETO);
  });

  it.each([
    ['JSON malformado', `{"description": "${RELATO_SECRETO}"`],
    ['texto que não é JSON', RELATO_SECRETO],
  ])('%s com texto de relato responde 400 sem o texto na resposta e no log', async (_caso, raw) => {
    const res = await request(t.app.getHttpServer())
      .post('/api/fixtures/errors/echo')
      .set('Content-Type', 'application/json')
      .send(raw)
      .expect(400);

    expect(Object.keys(res.body).sort()).toEqual(['error', 'message', 'requestId', 'statusCode']);
    expect(JSON.stringify(res.body)).not.toContain(RELATO_SECRETO);
    expect(t.logs.text()).not.toContain(RELATO_SECRETO);
  });

  it('corpo vazio com content-type JSON não ecoa nada', async () => {
    const res = await request(t.app.getHttpServer())
      .post('/api/fixtures/errors/echo')
      .set('Content-Type', 'application/json')
      .send('')
      .expect(400);
    expect(res.body.statusCode).toBe(400);
  });

  it('rota inexistente não repete caminho nem query string na resposta', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/nao-existe?protocol=DV-SEGREDO').expect(404);
    expect(JSON.stringify(res.body)).not.toContain('DV-SEGREDO');
  });
});
