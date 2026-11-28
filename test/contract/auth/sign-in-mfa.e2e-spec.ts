import { performance } from 'node:perf_hooks';
import { PasswordHasher } from '@nestjs/authentication';
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
import { ExampleCredentials } from './example/example-auth.controller.js';
import { ExampleAuthModule } from './example/example.module.js';

/** Login, MFA e cookie com o pacote escolhido (US2, T020, FR-005 a FR-007, FR-010, FR-011, FR-015). */
describe('Login com senha e segundo fator (e2e, teste de contrato)', () => {
  let t: TestApp;
  let ds: DataSource;
  const clock = new TestClock();
  const ME = '/api/admin/v1/example-auth/me';
  const SHORT = 'XQZ';

  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createTestApp({
      vault: 'api',
      imports: [ExampleAuthModule],
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
      .post('/api/admin/v1/example-auth/sign-in')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    expect(first.body).toEqual({ mfaRequired: true });
    const pending = sessionCookie(first)!;
    await request(server()).get(ME).set('Cookie', pending).expect(401);

    const second = await request(server())
      .post('/api/admin/v1/example-auth/mfa')
      .set('Cookie', pending)
      .send({ code: totp(staff.secret!, clock.now()) })
      .expect(200);
    const verified = sessionCookie(second)!;
    expect(verified).not.toEqual(pending); // id trocado depois do MFA
    await request(server()).get(ME).set('Cookie', verified).expect(200, { id: staff.id });
    await request(server()).get(ME).set('Cookie', pending).expect(401); // o id antigo morreu
  });

  it('o mesmo código TOTP é recusado na segunda vez', async () => {
    const staff = await newStaff();
    const code = totp(staff.secret!, clock.now());
    for (const expected of [200, 401]) {
      const first = await request(server())
        .post('/api/admin/v1/example-auth/sign-in')
        .send({ email: staff.email, password: staff.password });
      await request(server())
        .post('/api/admin/v1/example-auth/mfa')
        .set('Cookie', sessionCookie(first)!)
        .send({ code })
        .expect(expected);
    }
  });

  it('sessão com segundo fator pendente expira em 10 min', async () => {
    const staff = await newStaff();
    const first = await request(server())
      .post('/api/admin/v1/example-auth/sign-in')
      .send({ email: staff.email, password: staff.password });
    clock.advance(11 * MINUTE);
    await request(server())
      .post('/api/admin/v1/example-auth/mfa')
      .set('Cookie', sessionCookie(first)!)
      .send({ code: totp(staff.secret!, clock.now()) })
      .expect(401);
  });

  it('usuário sem segundo fator cadastrado não abre rota administrativa (MFA obrigatório)', async () => {
    const staff = await createStaff(t.app, [Role.ANALYST], { mfa: false });
    const first = await request(server())
      .post('/api/admin/v1/example-auth/sign-in')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    await request(server()).get(ME).set('Cookie', sessionCookie(first)!).expect(401);
  });

  it('e-mail inexistente e senha errada: mesma resposta', async () => {
    const staff = await newStaff();
    const unknown = await request(server())
      .post('/api/admin/v1/example-auth/sign-in')
      .send({ email: 'ninguem@equipe.test', password: staff.password });
    const wrong = await request(server())
      .post('/api/admin/v1/example-auth/sign-in')
      .send({ email: staff.email, password: SHORT });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const { requestId: _a, ...unknownBody } = unknown.body as Record<string, unknown>;
    const { requestId: _b, ...wrongBody } = wrong.body as Record<string, unknown>;
    expect(unknownBody).toEqual(wrongBody);
  });

  it('e-mail inexistente e senha errada: diferença de tempo menor que 10% da verificação (20 de cada)', async () => {
    // Custo maior que o dos testes (logN 14) para o sinal da verificação dominar o ruído da máquina.
    const hasher = new PasswordHasher({ logN: 14 });
    const creds = t.app.get(ExampleCredentials);
    const email = `tempo-${Date.now()}@equipe.test`;
    await ds.query(`INSERT INTO users (name, email, password_hash) VALUES ('Tempo', $1, $2)`, [
      email,
      await hasher.hash('senha-certa-de-teste'),
    ]);
    const time = async (fn: () => Promise<unknown>) => {
      const start = performance.now();
      await fn();
      return performance.now() - start;
    };
    const unknown: number[] = [];
    const wrong: number[] = [];
    for (let i = 0; i < 20; i++) {
      unknown.push(await time(() => creds.verify('ninguem@equipe.test', 'qualquer', hasher)));
      wrong.push(await time(() => creds.verify(email, 'senha-errada', hasher)));
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const diff = Math.abs(median(unknown) - median(wrong));
    process.stderr.write(
      `[SC-006] mediana e-mail inexistente ${median(unknown).toFixed(1)} ms; senha errada ${median(wrong).toFixed(1)} ms; diferença ${diff.toFixed(1)} ms\n`,
    );
    expect(diff).toBeLessThan(0.1 * median(wrong));
  }, 60_000);

  it('cookie __Host-sid HttpOnly, Secure, SameSite=Strict, Path=/; token fora do corpo e da URL', async () => {
    const staff = await newStaff();
    const res = await request(server())
      .post('/api/admin/v1/example-auth/sign-in')
      .send({ email: staff.email, password: staff.password });
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
    const first = await request(server())
      .post('/api/admin/v1/example-auth/sign-in')
      .send({ email: staff.email, password: staff.password });
    await request(server())
      .post('/api/admin/v1/example-auth/mfa')
      .set('Cookie', sessionCookie(first)!)
      .send({ code: '000000' })
      .expect(401);
    clock.advance(30_000);
    const cookie = await signInFully(t.app, staff, clock.now());
    await request(server()).post('/api/admin/v1/example-auth/sign-out').set('Cookie', cookie).expect(204);

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
