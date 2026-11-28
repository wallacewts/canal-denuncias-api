import request from 'supertest';
import { KeyServiceFixtureModule } from '../support/fixtures/key-service-fixture.module.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** SC-005: com o Vault inacessível, a API responde 503 em até 3 s, sem travar. */
describe('Serviço de chaves indisponível (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    // Endereço não roteável: a conexão fica pendurada e só o timeout de 2 s a encerra.
    process.env.VAULT_ADDR = 'http://10.255.255.1:8200';
    t = await createTestApp({ imports: [KeyServiceFixtureModule] });
  });

  afterAll(async () => {
    await t.close();
  });

  it('responde 503 no formato de erro em até 3 s', async () => {
    const started = Date.now();
    const res = await request(t.app.getHttpServer()).get('/api/fixtures/key-service/datakey').expect(503);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(res.body).toMatchObject({ statusCode: 503, error: 'Service Unavailable' });
    expect(res.body.requestId).toEqual(expect.any(String));
  });
});
