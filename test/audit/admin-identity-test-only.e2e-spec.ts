import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Role } from '../../src/common/enums/role.enum.js';
import { testIdentity, TEST_IDENTITY_HEADER } from '../support/fake-identity.js';
import { PublicFixtureModule } from '../support/fixtures/public-fixture.module.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Área administrativa com a identidade só de teste (D47). Um app por arquivo: o AppModule fica preso ao banco da suíte. */
describe('Área administrativa: identidade de teste (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ imports: [PublicFixtureModule], identity: true });
  });
  afterAll(async () => {
    await t.close();
  });

  it('com identidade válida, a rota responde', async () => {
    await request(t.app.getHttpServer())
      .get('/api/admin/v1/fixtures/sensitive')
      .set(testIdentity(randomUUID(), Role.ANALYST))
      .expect(200);
  });

  it('sem cabeçalho ou com valor malformado, 401', async () => {
    for (const value of [undefined, 'XQZ', `${randomUUID()}:`, `nao-uuid:${Role.ADMIN}`]) {
      const req = request(t.app.getHttpServer()).get('/api/admin/v1/fixtures/sensitive');
      await (value === undefined ? req : req.set(TEST_IDENTITY_HEADER, value)).expect(401);
    }
  });
});
