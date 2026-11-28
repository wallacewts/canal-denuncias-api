import { inflateSync } from 'node:zlib';
import request from 'supertest';
import { Role } from '../../src/common/enums/role.enum.js';
import { sessionCookie, totp } from '../contract/auth/example/auth-helpers.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import type { DataSource } from 'typeorm';
import { auditRows, createAuthApp, ME, signIn, signInReal, staffWithMfa, waitRows } from './support.js';

const ENROLL = '/api/admin/v1/auth/mfa/enrollment';
const CONFIRM = '/api/admin/v1/auth/mfa/enrollment/confirmation';
const PASSWORD = '/api/admin/v1/me/password';
const NEW_PASSWORD = 'minha frase nova de primeiro acesso';

/** US2 (T029): primeiro acesso de quem o Administrador cadastrou, até DONE. */
describe('Primeiro acesso (e2e)', () => {
  let t: TestApp & { clock: TestClock; ds: DataSource };
  let adminCookie: string;
  const server = () => t.app.getHttpServer();
  const post = (path: string, cookie: string, body: object = {}) =>
    request(server()).post(path).set('Cookie', cookie).send(body);

  beforeAll(async () => {
    t = await createAuthApp();
    const admin = await staffWithMfa(t, Role.ADMIN);
    adminCookie = await signInReal(t.app, admin, t.clock.now());
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const newcomer = async () => {
    const email = `novo.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@empresa.test`;
    const res = await request(server())
      .post('/api/admin/v1/users')
      .set('Cookie', adminCookie)
      .send({ name: 'Nova', email, roles: [Role.ANALYST] })
      .expect(201);
    const body = res.body as { user: { id: string }; temporaryPassword: string };
    return { id: body.user.id, email, temporaryPassword: body.temporaryPassword };
  };

  it('troca, cadastro com PNG, confirmação com 10 códigos e acesso liberado', async () => {
    const person = await newcomer();
    const first = await signIn(t.app, person.email, person.temporaryPassword).expect(200);
    expect(first.body).toMatchObject({ nextStep: 'PASSWORD_CHANGE_REQUIRED' });
    let cookie = sessionCookie(first)!;
    await request(server()).get(ME).set('Cookie', cookie).expect(401);
    await request(server()).get('/api/admin/v1/users').set('Cookie', cookie).expect(401);
    const early = await post(ENROLL, cookie).expect(403);
    expect(early.body).toMatchObject({ code: 'STEP_NOT_ALLOWED' });

    const changed = await request(server())
      .put(PASSWORD)
      .set('Cookie', cookie)
      .send({ currentPassword: person.temporaryPassword, newPassword: NEW_PASSWORD })
      .expect(200);
    expect(changed.body).toMatchObject({ nextStep: 'MFA_ENROLLMENT_REQUIRED' });
    cookie = sessionCookie(changed)!;
    await request(server()).get(ME).set('Cookie', cookie).expect(401);

    const firstEnroll = await post(ENROLL, cookie).expect(200);
    const enroll = await post(ENROLL, cookie).expect(200);
    const body = enroll.body as { otpauthUri: string; qrCodeDataUri: string; secret: string };
    expect(Object.keys(body).sort()).toEqual(['otpauthUri', 'qrCodeDataUri', 'secret']);
    expect(body.secret).not.toBe((firstEnroll.body as { secret: string }).secret); // o segundo substitui
    expect(body.otpauthUri).toContain(`secret=${body.secret}`);
    expect(body.otpauthUri).toContain('issuer=Canal%20de%20Den%C3%BAncias');
    const png = Buffer.from(body.qrCodeDataUri.split(',')[1], 'base64');
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(() => inflateSync(png.subarray(41, png.length - 16))).not.toThrow();

    t.clock.advance(30_000);
    const wrong = await post(CONFIRM, cookie, { code: '000000' }).expect(422);
    expect(wrong.body).toMatchObject({ code: 'MFA_CODE_INVALID' });
    const done = await post(CONFIRM, cookie, { code: totp(body.secret, t.clock.now()) }).expect(200);
    const result = done.body as { recoveryCodes: string[]; nextStep: string };
    expect(result.nextStep).toBe('DONE');
    expect(result.recoveryCodes).toHaveLength(10);
    expect(new Set(result.recoveryCodes).size).toBe(10);
    const fresh = sessionCookie(done)!;
    expect(fresh).not.toBe(cookie);
    const me = await request(server()).get(ME).set('Cookie', fresh).expect(200);
    expect(me.body).toMatchObject({ passwordChangeRequired: false });
    expect((me.body as { mfaEnabledAt: string | null }).mfaEnabledAt).not.toBeNull();

    expect(await waitRows(() => auditRows(t.ds, 'AUTH_MFA_ENROLLED', 'resource_id = $2', [person.id]))).toHaveLength(1);
    expect(await waitRows(() => auditRows(t.ds, 'AUTH_SIGNED_IN', 'actor_user_id = $2', [person.id]))).toHaveLength(1);
    const trail = JSON.stringify(await t.ds.query(`SELECT * FROM audit_logs`));
    for (const text of [trail, t.logs.text()]) {
      expect(text).not.toContain(body.secret);
      expect(text).not.toContain(body.qrCodeDataUri.slice(30, 60));
      for (const code of result.recoveryCodes) expect(text).not.toContain(code);
      expect(text).not.toContain(person.temporaryPassword);
    }
    // Depois de DONE, as rotas de cadastro ficam fora da etapa.
    await post(ENROLL, fresh).expect(403);
  });

  it('conta bloqueada pelo Administrador no meio do primeiro acesso: 401 na etapa seguinte', async () => {
    const person = await newcomer();
    const cookie = sessionCookie(await signIn(t.app, person.email, person.temporaryPassword).expect(200))!;
    await request(server())
      .put(`/api/admin/v1/users/${person.id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'BLOCKED' })
      .expect(200);
    await request(server())
      .put(PASSWORD)
      .set('Cookie', cookie)
      .send({ currentPassword: person.temporaryPassword, newPassword: NEW_PASSWORD })
      .expect(401);
  });

  it('depois do reset do MFA pelo Administrador, a entrada volta a MFA_ENROLLMENT_REQUIRED', async () => {
    const staff = await staffWithMfa(t, Role.DPO);
    await request(server()).post(`/api/admin/v1/users/${staff.id}/mfa-reset`).set('Cookie', adminCookie).expect(204);
    const res = await signIn(t.app, staff.email, staff.password).expect(200);
    expect(res.body).toMatchObject({ nextStep: 'MFA_ENROLLMENT_REQUIRED' });
  });
});
