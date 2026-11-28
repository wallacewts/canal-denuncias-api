import request from 'supertest';
import { Role } from '../../src/common/enums/role.enum.js';
import { createStaff, sessionCookie, totp } from '../contract/auth/example/auth-helpers.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import type { DataSource } from 'typeorm';
import { challenge, createAuthApp, ME, signIn } from './support.js';

/** US3 (T023, R11): sessão verificada com troca obrigatória pendente só abre a troca, a saída e o GET /me. */
describe('Troca obrigatória pendente (e2e)', () => {
  let t: TestApp & { clock: TestClock; ds: DataSource };
  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createAuthApp();
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('403 PASSWORD_CHANGE_REQUIRED nas outras rotas; GET /me e saída liberados; depois da troca, tudo volta', async () => {
    const staff = await createStaff(t.app, [Role.ADMIN, Role.AUDITOR], {
      nowMs: t.clock.now(),
      passwordChanged: false,
    });
    t.clock.advance(60_000);
    const first = await signIn(t.app, staff.email, staff.password).expect(200);
    const res = await challenge(t.app, sessionCookie(first)!, { code: totp(staff.secret!, t.clock.now()) }).expect(200);
    expect(res.body).toMatchObject({ nextStep: 'PASSWORD_CHANGE_REQUIRED' });
    const cookie = sessionCookie(res)!;

    for (const path of ['/api/admin/v1/users', '/api/admin/v1/audit-logs']) {
      const denied = await request(server()).get(path).set('Cookie', cookie).expect(403);
      expect(denied.body).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    const me = await request(server()).get(ME).set('Cookie', cookie).expect(200);
    expect(me.body).toMatchObject({ passwordChangeRequired: true });

    const changed = await request(server())
      .put('/api/admin/v1/me/password')
      .set('Cookie', cookie)
      .send({ currentPassword: staff.password, newPassword: 'outra frase longa e nova' })
      .expect(200);
    expect(changed.body).toMatchObject({ nextStep: 'DONE' });
    const fresh = sessionCookie(changed)!;
    await request(server()).get('/api/admin/v1/users').set('Cookie', fresh).expect(200);
    await request(server()).post('/api/admin/v1/auth/sign-out').set('Cookie', fresh).expect(204);
  });
});
