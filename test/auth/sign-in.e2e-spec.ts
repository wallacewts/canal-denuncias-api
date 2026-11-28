import { PasswordHasher } from '@nestjs/authentication';
import { Role } from '../../src/common/enums/role.enum.js';
import { createStaff, sessionCookie } from '../contract/auth/example/auth-helpers.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import type { DataSource } from 'typeorm';
import request from 'supertest';
import { auditRows, createAuthApp, ME, signIn, staffWithMfa, withoutRequestId } from './support.js';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** US1 (T014): entrada com senha, resposta genérica, motivo só na trilha, rehash e nada vazado. */
describe('Entrada com senha (e2e)', () => {
  let t: TestApp & { clock: TestClock; ds: DataSource };

  beforeAll(async () => {
    t = await createAuthApp();
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('senha certa: 200 MFA_REQUIRED com horários e cookie que ainda não abre a área administrativa', async () => {
    const staff = await staffWithMfa(t, Role.ANALYST);
    const res = await signIn(t.app, staff.email, staff.password).expect(200);
    expect(Object.keys(res.body as object).sort()).toEqual(['absoluteExpiresAt', 'idleExpiresAt', 'nextStep']);
    expect(res.body).toMatchObject({ nextStep: 'MFA_REQUIRED' });
    expect((res.body as { idleExpiresAt: string }).idleExpiresAt).toMatch(ISO_UTC);
    const cookie = sessionCookie(res)!;
    expect(cookie).toBeTruthy();
    await request(t.app.getHttpServer()).get(ME).set('Cookie', cookie).expect(401);
    expect(res.text).not.toContain(staff.password);
  });

  it('inexistente, senha errada, BLOCKED, DISABLED e bloqueio temporário: mesma resposta 401 e motivo só na trilha', async () => {
    const wrong = await staffWithMfa(t, Role.ANALYST);
    const blocked = await staffWithMfa(t, Role.ANALYST);
    const disabled = await staffWithMfa(t, Role.ANALYST);
    const locked = await staffWithMfa(t, Role.ANALYST);
    await t.ds.query(`UPDATE users SET status = 'BLOCKED' WHERE id = $1`, [blocked.id]);
    await t.ds.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [disabled.id]);
    await t.ds.query(`UPDATE users SET locked_until = $2 WHERE id = $1`, [locked.id, new Date(t.clock.now() + 60_000)]);

    const attempts = [
      ['ninguem.xqz@empresa.test', 'senha-qualquer-XQZ', null, 'UNKNOWN_ACCOUNT'],
      [wrong.email, 'senha-errada-XQZ', wrong.id, 'BAD_CREDENTIALS'],
      [blocked.email, blocked.password, blocked.id, 'BLOCKED'],
      [disabled.email, disabled.password, disabled.id, 'DISABLED'],
      [locked.email, locked.password, locked.id, 'TEMPORARILY_LOCKED'],
    ] as const;
    const bodies: unknown[] = [];
    for (const [email, password, id, reason] of attempts) {
      const res = await signIn(t.app, email, password).expect(401);
      expect(sessionCookie(res)).toBeNull();
      bodies.push(withoutRequestId(res.body));
      const rows = id
        ? await auditRows(t.ds, 'AUTH_LOGIN_FAILED', 'resource_id = $2', [id])
        : await auditRows(t.ds, 'AUTH_LOGIN_FAILED', `metadata->>'reason' = 'UNKNOWN_ACCOUNT'`);
      expect(rows.at(-1)).toMatchObject({ actor_type: 'STAFF', actor_user_id: null, result: 'FAILURE' });
      expect((rows.at(-1)!.metadata as { reason: string }).reason).toBe(reason);
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);

    const trail = JSON.stringify(await t.ds.query(`SELECT * FROM audit_logs`));
    const logs = t.logs.text();
    for (const text of [trail, logs]) {
      expect(text).not.toContain('XQZ');
      expect(text).not.toContain('ninguem.xqz');
      expect(text).not.toContain(wrong.email);
    }
  });

  it('hash com custo menor é refeito com o custo atual na entrada correta', async () => {
    const staff = await createStaff(t.app, [Role.DPO], { mfa: false, nowMs: t.clock.now() });
    // Parâmetro mais fraco que o configurado (r = 4): o pacote não aceita logN abaixo de 10.
    const cheap = await new PasswordHasher({ logN: 10, r: 4 }).hash(staff.password);
    await t.ds.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [staff.id, cheap]);
    await signIn(t.app, staff.email, staff.password).expect(200);
    const [row] = (await t.ds.query(`SELECT password_hash FROM users WHERE id = $1`, [staff.id])) as Array<{
      password_hash: string;
    }>;
    expect(row.password_hash).not.toBe(cheap);
    expect(t.app.get(PasswordHasher).needsRehash(row.password_hash)).toBe(false);
  });

  it('corpo inválido: 400 sem ecoar valor', async () => {
    const res = await request(t.app.getHttpServer())
      .post('/api/admin/v1/auth/sign-in')
      .send({ email: 'a@b.c', password: 'p', otp: 'XQZ' })
      .expect(400);
    expect(res.text).not.toContain('XQZ');
  });
});
