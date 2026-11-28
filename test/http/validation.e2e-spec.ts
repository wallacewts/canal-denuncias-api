import request from 'supertest';
import { ValidationFixtureModule } from '../support/fixtures/validation-fixture.module.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

const SEGREDO = 'RELATO-SECRETO-QUE-NAO-PODE-VOLTAR-91c2';

describe('Validação de entrada (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [ValidationFixtureModule] });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(() => t.logs.clear());

  const post = (body: unknown, query = '') =>
    request(t.app.getHttpServer())
      .post(`/api/fixtures/validation${query}`)
      .send(body as object);

  it('aceita uma entrada válida', async () => {
    const res = await post({ description: 'curto', count: 2 }, '?page=1').expect(200);
    expect(res.body).toEqual({ received: { length: 5, count: 2, page: 1 } });
  });

  it('recusa campo desconhecido com 400, sem repetir o nome do campo', async () => {
    const res = await post({ description: 'ok', count: 1, [SEGREDO]: true }).expect(400);
    expect(res.body.message).toEqual([{ path: '', code: 'unrecognized_keys', message: 'Campo não permitido' }]);
    expect(JSON.stringify(res.body)).not.toContain(SEGREDO);
  });

  it('recusa texto acima do limite, sem repetir o texto', async () => {
    const res = await post({ description: `${SEGREDO}${'x'.repeat(50)}`, count: 1 }).expect(400);
    expect(res.body.message).toEqual([{ path: 'description', code: 'too_big', message: 'Máximo de 50 caracteres' }]);
    expect(JSON.stringify(res.body)).not.toContain(SEGREDO);
  });

  it('recusa tipo errado, sem repetir o valor', async () => {
    const res = await post({ description: 'ok', count: SEGREDO }).expect(400);
    expect(res.body.message).toEqual([
      { path: 'count', code: 'invalid_type', message: 'Tipo inválido: esperado number' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(SEGREDO);
  });

  it('valida também a query string, sem repetir o valor', async () => {
    const res = await post({ description: 'ok', count: 1 }, `?extra=${SEGREDO}`).expect(400);
    expect(res.body.message[0].code).toBe('unrecognized_keys');
    expect(JSON.stringify(res.body)).not.toContain(SEGREDO);
  });

  it('nenhum valor recusado vai para o log', async () => {
    await post({ description: SEGREDO.repeat(3), count: SEGREDO, [SEGREDO]: 1 }).expect(400);
    expect(t.logs.text()).not.toContain(SEGREDO);
  });
});
