import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { Role } from '../../../src/common/enums/role.enum.js';
import { AUTH_CLOCK } from '../../../src/infra/auth/auth-clock.js';
import { MINUTE, TestClock } from '../../support/auth-clock.js';
import { createTestApp, type TestApp } from '../../support/test-app.js';
import {
  createStaff,
  rawSetCookie,
  sessionCookie,
  signInFully,
  totp,
  waitForAudit,
  type Staff,
} from './example/auth-helpers.js';

/**
 * Login, MFA e cookie com o pacote escolhido (feature 004, US2), agora pelas rotas definitivas da feature 006 (o login
 * de exemplo foi promovido). Código recusado é 422 (feature 006, Q1); o tempo constante está em
 * `test/auth/sign-in-timing.e2e-spec.ts`.
 */
describe('Login com senha e segundo fator (e2e, teste de contrato)', () => {
  let t: TestApp;
  let ds: DataSource;
  const clock = new TestClock();
  const ME = '/api/admin/v1/me';
  const SIGN_IN = '/api/admin/v1/auth/sign-in';
  const MFA = '/api/admin/v1/auth/mfa/challenge';
  const SHORT = 'XQZ';

  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createTestApp({
      vault: 'api',
      overrides: [{ provide: AUTH_CLOCK, useValue: clock }],
    });
    ds = t.app.get<DataSource>(getDataSourceToken());
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const newStaff = async (): Promise<Staff> => {
    const staff = await createStaff(t.app, [Role.ANALYST], { nowMs: clock.now() });
    clock.advance(30_000); // o código da confirmação não vale de novo
    return staff;
  };

  it('só a senha não abre rota protegida; senha + TOTP abre', async () => {
    const staff = await newStaff();
    const first = await request(server())
      .post(SIGN_IN)
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    expect(first.body).toMatchObject({ nextStep: 'MFA_REQUIRED' });
    const pending = sessionCookie(first)!;
    await request(server()).get(ME).set('Cookie', pending).expect(401);

    const second = await request(server())
      .post(MFA)
      .set('Cookie', pending)
      .send({ code: totp(staff.secret!, clock.now()) })
      .expect(200);
    const verified = sessionCookie(second)!;
    expect(verified).not.toEqual(pending); // id trocado depois do MFA
    const me = await request(server()).get(ME).set('Cookie', verified).expect(200);
    expect((me.body as { id: string }).id).toBe(staff.id);
    await request(server()).get(ME).set('Cookie', pending).expect(401); // o id antigo morreu
  });

  it('o mesmo código TOTP é recusado na segunda vez', async () => {
    const staff = await newStaff();
    const code = totp(staff.secret!, clock.now());
    for (const expected of [200, 422]) {
      const first = await request(server()).post(SIGN_IN).send({ email: staff.email, password: staff.password });
      await request(server()).post(MFA).set('Cookie', sessionCookie(first)!).send({ code }).expect(expected);
    }
  });

  it('sessão com segundo fator pendente expira em 10 min', async () => {
    const staff = await newStaff();
    const first = await request(server()).post(SIGN_IN).send({ email: staff.email, password: staff.password });
    clock.advance(11 * MINUTE);
    await request(server())
      .post(MFA)
      .set('Cookie', sessionCookie(first)!)
      .send({ code: totp(staff.secret!, clock.now()) })
      .expect(401);
  });

  it('usuário sem segundo fator cadastrado não abre rota administrativa (MFA obrigatório)', async () => {
    const staff = await createStaff(t.app, [Role.ANALYST], { mfa: false });
    const first = await request(server())
      .post(SIGN_IN)
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    await request(server()).get(ME).set('Cookie', sessionCookie(first)!).expect(401);
  });

  it('e-mail inexistente e senha errada: mesma resposta', async () => {
    const staff = await newStaff();
    const unknown = await request(server())
      .post(SIGN_IN)
      .send({ email: 'ninguem@equipe.test', password: staff.password });
    const wrong = await request(server()).post(SIGN_IN).send({ email: staff.email, password: SHORT });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const { requestId: _a, ...unknownBody } = unknown.body as Record<string, unknown>;
    const { requestId: _b, ...wrongBody } = wrong.body as Record<string, unknown>;
    expect(unknownBody).toEqual(wrongBody);
  });

  it('cookie __Host-sid HttpOnly, Secure, SameSite=Strict, Path=/; token fora do corpo e da URL', async () => {
    const staff = await newStaff();
    const res = await request(server()).post(SIGN_IN).send({ email: staff.email, password: staff.password });
    const raw = rawSetCookie(res)!;
    expect(raw).toMatch(/^__Host-sid=[^;]+;/);
    expect(raw).toMatch(/; HttpOnly/);
    expect(raw).toMatch(/; Secure/);
    expect(raw).toMatch(/; SameSite=Strict/);
    expect(raw).toMatch(/; Path=\//);
    const token = sessionCookie(res)!.split('=')[1];
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(res.headers.location).toBeUndefined();
  });

  it('Authorization: Bearer não autentica rota administrativa (só o cookie)', async () => {
    await request(server()).get(ME).set('Authorization', `Bearer ${SHORT}`).expect(401);
  });

  it('a trilha registra login, código errado e saída, sem segredo na metadata', async () => {
    const staff = await newStaff();
    // Código errado primeiro.
    const first = await request(server()).post(SIGN_IN).send({ email: staff.email, password: staff.password });
    await request(server()).post(MFA).set('Cookie', sessionCookie(first)!).send({ code: '000000' }).expect(422);
    clock.advance(30_000);
    const cookie = await signInFully(t.app, staff, clock.now());
    await request(server()).post('/api/admin/v1/auth/sign-out').set('Cookie', cookie).expect(204);

    const signedIn = await waitForAudit(t.app, staff.id, 'AUTH_SIGNED_IN');
    const failed = await waitForAudit(t.app, staff.id, 'AUTH_MFA_FAILED');
    const out = await waitForAudit(t.app, staff.id, 'AUTH_SIGNED_OUT');
    expect(signedIn).toHaveLength(1);
    expect(signedIn[0].metadata).toEqual({ method: 'password' });
    expect(failed[0].metadata).toEqual({ locked: false });
    expect(out).toHaveLength(1);
    const all = JSON.stringify(await ds.query(`SELECT metadata FROM audit_logs WHERE actor_user_id = $1`, [staff.id]));
    for (const secret of [staff.password, staff.secret!, cookie.split('=')[1], '000000']) {
      expect(all).not.toContain(secret);
    }
  });
});
