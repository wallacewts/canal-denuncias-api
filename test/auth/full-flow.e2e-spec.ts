import request from 'supertest';
import { Role } from '../../src/common/enums/role.enum.js';
import { stepResponseSchema } from '../../src/modules/auth/auth.schemas.js';
import { rawSetCookie, sessionCookie, totp } from '../contract/auth/example/auth-helpers.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import type { DataSource } from 'typeorm';
import { challenge, createAuthApp, ME, signIn, staffWithMfa } from './support.js';

const COOKIE_ATTRS = (raw: string | undefined) => {
  expect(raw).toMatch(/^__Host-sid=/);
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(raw).toContain(attr);
  expect(raw).not.toMatch(/Domain=/i);
};

/** AUTH-06 (T017): o fluxo inteiro pelas rotas definitivas, sem o login de exemplo. */
describe('Fluxo inteiro de login (e2e)', () => {
  let t: TestApp & { clock: TestClock; ds: DataSource };
  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createAuthApp();
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('entrada, desafio, rota protegida, saída e rota protegida de novo (401)', async () => {
    const staff = await staffWithMfa(t, Role.COMPLIANCE_MANAGER);
    const first = await signIn(t.app, staff.email, staff.password).expect(200);
    COOKIE_ATTRS(rawSetCookie(first));
    // As respostas reais obedecem aos schemas publicados no OpenAPI (os mesmos comparados com o contrato do front).
    expect(stepResponseSchema.safeParse(first.body).success).toBe(true);
    const second = await challenge(t.app, sessionCookie(first)!, { code: totp(staff.secret!, t.clock.now()) }).expect(
      200,
    );
    COOKIE_ATTRS(rawSetCookie(second));
    expect(stepResponseSchema.safeParse(second.body).success).toBe(true);
    const cookie = sessionCookie(second)!;
    await request(server()).get(ME).set('Cookie', cookie).expect(200);
    const out = await request(server()).post('/api/admin/v1/auth/sign-out').set('Cookie', cookie).expect(204);
    expect(sessionCookie(out)).toBeNull();
    expect(rawSetCookie(out)).toMatch(/__Host-sid=;|Max-Age=0|Expires=Thu, 01 Jan 1970/);
    await request(server()).get(ME).set('Cookie', cookie).expect(401);
  });

  it('a saída também funciona com a sessão pendente', async () => {
    const staff = await staffWithMfa(t, Role.DPO);
    const first = await signIn(t.app, staff.email, staff.password).expect(200);
    const cookie = sessionCookie(first)!;
    await request(server()).post('/api/admin/v1/auth/sign-out').set('Cookie', cookie).expect(204);
    await challenge(t.app, cookie, { code: totp(staff.secret!, t.clock.now()) }).expect(401);
  });
});
