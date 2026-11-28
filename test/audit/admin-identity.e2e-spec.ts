import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Role } from '../../src/common/enums/role.enum.js';
import { testIdentity } from '../support/fake-identity.js';
import { PublicFixtureModule } from '../support/fixtures/public-fixture.module.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Área administrativa negada por padrão até a AUTH-06 (D47, FR-019, princípio IV). Porta padrão, como em produção. */
describe('Área administrativa sem identidade: porta padrão (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ imports: [PublicFixtureModule] });
  });
  afterAll(async () => {
    await t.close();
  });

  it('responde 401 no formato único, mesmo com cabeçalhos de identidade', async () => {
    for (const headers of [{}, testIdentity(randomUUID(), Role.AUDITOR), { authorization: 'Bearer XQZ' }]) {
      const res = await request(t.app.getHttpServer()).get('/api/admin/v1/fixtures/sensitive').set(headers).expect(401);
      expect(Object.keys(res.body).sort()).toEqual(['error', 'message', 'requestId', 'statusCode']);
      expect(JSON.stringify(res.body)).not.toContain('XQZ');
    }
  });

  it('não afeta as rotas públicas', async () => {
    await request(t.app.getHttpServer()).get(`/api/public/v1/fixtures/attachments/${randomUUID()}`).expect(200);
  });
});
