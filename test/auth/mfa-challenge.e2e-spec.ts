import { MfaService } from '@nestjs/authentication';
import request from 'supertest';
import { Role } from '../../src/common/enums/role.enum.js';
import { sessionCookie, totp } from '../contract/auth/example/auth-helpers.js';
import { MINUTE, type TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import type { DataSource } from 'typeorm';
import { auditRows, challenge, createAuthApp, ME, signIn, staffWithMfa, waitRows } from './support.js';

/** US1 (T016): desafio do segundo fator com 422 e 423, recuperação de uso único e a ordem da Q2. */
describe('Desafio do segundo fator (e2e)', () => {
  let t: TestApp & { clock: TestClock; ds: DataSource };
  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createAuthApp();
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const pending = async (roles = [Role.ANALYST]) => {
    const staff = await staffWithMfa(t, ...roles);
    const res = await signIn(t.app, staff.email, staff.password).expect(200);
    return { staff, cookie: sessionCookie(res)! };
  };

  it.each([0, -1, 1])('código válido (passo %i): DONE, cookie novo e o antigo sem valor', async (offset) => {
    const { staff, cookie } = await pending();
    const res = await challenge(t.app, cookie, { code: totp(staff.secret!, t.clock.now(), offset) }).expect(200);
    expect(res.body).toMatchObject({ nextStep: 'DONE' });
    const fresh = sessionCookie(res)!;
    expect(fresh).not.toBe(cookie);
    await request(server()).get(ME).set('Cookie', fresh).expect(200);
    await request(server()).get(ME).set('Cookie', cookie).expect(401);
  });

  it('código errado ou repetido: 422 MFA_CODE_INVALID com a sessão pendente intacta', async () => {
    const { staff, cookie } = await pending();
    const bad = await challenge(t.app, cookie, { code: '000000' }).expect(422);
    expect(bad.body).toMatchObject({ code: 'MFA_CODE_INVALID' });
    const good = totp(staff.secret!, t.clock.now());
    const ok = await challenge(t.app, cookie, { code: good }).expect(200);
    // O mesmo código numa nova entrada: recusado.
    const again = await signIn(t.app, staff.email, staff.password).expect(200);
    await challenge(t.app, sessionCookie(again)!, { code: good }).expect(422);
    expect(sessionCookie(ok)).toBeTruthy();
  });

  it('5 errados: o sexto dá 423 MFA_LOCKED, mesmo com o código certo', async () => {
    const { staff, cookie } = await pending();
    for (let i = 0; i < 5; i++) await challenge(t.app, cookie, { code: '000000' }).expect(422);
    const locked = await challenge(t.app, cookie, { code: totp(staff.secret!, t.clock.now()) }).expect(423);
    expect(locked.body).toMatchObject({ code: 'MFA_LOCKED' });
  });

  it('código de recuperação (minúsculas e espaços) vale uma vez e grava AUTH_RECOVERY_CODE_USED', async () => {
    const { staff, cookie } = await pending();
    const [code] = await t.app.get(MfaService).generateRecoveryCodes(staff.id);
    const messy = ` ${code.toLowerCase().replace('-', ' ')} `;
    await challenge(t.app, cookie, { recoveryCode: messy }).expect(200);
    const again = await signIn(t.app, staff.email, staff.password).expect(200);
    await challenge(t.app, sessionCookie(again)!, { recoveryCode: code }).expect(422);
    const rows = await waitRows(() => auditRows(t.ds, 'AUTH_RECOVERY_CODE_USED', 'actor_user_id = $2', [staff.id]));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(await t.ds.query(`SELECT * FROM audit_logs`))).not.toContain(code);
  });

  it('sem sessão pendente: 401; corpo com os dois códigos ou nenhum: 400', async () => {
    await request(server()).post('/api/admin/v1/auth/mfa/challenge').send({ code: '123456' }).expect(401);
    const { cookie } = await pending();
    await challenge(t.app, cookie, { code: '1', recoveryCode: '2' }).expect(400);
    await challenge(t.app, cookie, {}).expect(400);
  });

  it('sessão pendente que expira antes do desafio: 401', async () => {
    const { staff, cookie } = await pending();
    t.clock.advance(11 * MINUTE);
    await challenge(t.app, cookie, { code: totp(staff.secret!, t.clock.now()) }).expect(401);
  });

  it('com autenticador e troca obrigatória: PASSWORD_CHANGE_REQUIRED depois do desafio (Q2)', async () => {
    const { staff, cookie } = await pending();
    await t.ds.query(`UPDATE users SET password_changed_at = NULL WHERE id = $1`, [staff.id]);
    const res = await challenge(t.app, cookie, { code: totp(staff.secret!, t.clock.now()) }).expect(200);
    expect(res.body).toMatchObject({ nextStep: 'PASSWORD_CHANGE_REQUIRED' });
  });
});
