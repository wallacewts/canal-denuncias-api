import { Role } from '../../src/common/enums/role.enum.js';
import { lockoutMinutes } from '../../src/modules/auth/lockout.js';
import { sessionCookie, totp } from '../contract/auth/example/auth-helpers.js';
import { MINUTE, type TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import type { DataSource } from 'typeorm';
import { challenge, createAuthApp, signIn, staffWithMfa } from './support.js';

/** US1 (T015): bloqueio progressivo com o relógio controlado. */
describe('Bloqueio progressivo (e2e)', () => {
  let t: TestApp & { clock: TestClock; ds: DataSource };
  const state = async (id: string) =>
    (
      (await t.ds.query(`SELECT failed_login_count, locked_until, lockout_level FROM users WHERE id = $1`, [
        id,
      ])) as Array<{
        failed_login_count: number;
        locked_until: Date | null;
        lockout_level: number;
      }>
    )[0];

  beforeAll(async () => {
    t = await createAuthApp();
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const fail = async (email: string, n: number) => {
    for (let i = 0; i < n; i++) await signIn(t.app, email, 'senha-errada').expect(401);
  };

  it('5 falhas → 15 min (senha certa dá 401); passado o tempo, entra; nova série → 30 min', async () => {
    const staff = await staffWithMfa(t, Role.ANALYST);
    await fail(staff.email, 4);
    expect((await state(staff.id)).failed_login_count).toBe(4);
    await fail(staff.email, 1);
    let s = await state(staff.id);
    expect(s.lockout_level).toBe(1);
    expect(s.locked_until!.getTime()).toBe(t.clock.now() + 15 * MINUTE);
    await signIn(t.app, staff.email, staff.password).expect(401);

    t.clock.advance(15 * MINUTE + 1_000);
    await signIn(t.app, staff.email, staff.password).expect(200);

    await fail(staff.email, 5);
    s = await state(staff.id);
    expect(s.locked_until!.getTime()).toBe(t.clock.now() + 30 * MINUTE);
    t.clock.advance(15 * MINUTE + 1_000);
    await signIn(t.app, staff.email, staff.password).expect(401);
    t.clock.advance(15 * MINUTE);
    await signIn(t.app, staff.email, staff.password).expect(200);
  });

  it('teto de 24 h', async () => {
    const staff = await staffWithMfa(t, Role.ANALYST);
    await t.ds.query(`UPDATE users SET lockout_level = 10 WHERE id = $1`, [staff.id]);
    await fail(staff.email, 5);
    const s = await state(staff.id);
    expect(lockoutMinutes(10, { base: 15, max: 1440 })).toBe(1440);
    expect(s.locked_until!.getTime()).toBe(t.clock.now() + 1440 * MINUTE);
  });

  it('códigos errados no desafio somam no mesmo contador; a entrada completa zera tudo', async () => {
    const staff = await staffWithMfa(t, Role.ANALYST);
    await fail(staff.email, 2);
    const first = await signIn(t.app, staff.email, staff.password).expect(200);
    const cookie = sessionCookie(first)!;
    await challenge(t.app, cookie, { code: '000000' }).expect(422);
    expect((await state(staff.id)).failed_login_count).toBe(3);
    await challenge(t.app, cookie, { code: totp(staff.secret!, t.clock.now()) }).expect(200);
    expect(await state(staff.id)).toMatchObject({ failed_login_count: 0, lockout_level: 0, locked_until: null });
  });

  it('10 falhas simultâneas não passam do limiar: um bloqueio só', async () => {
    const staff = await staffWithMfa(t, Role.ANALYST);
    await Promise.all(Array.from({ length: 10 }, () => signIn(t.app, staff.email, 'senha-errada').expect(401)));
    const s = await state(staff.id);
    expect(s.lockout_level).toBe(1);
    expect(s.locked_until!.getTime()).toBe(t.clock.now() + 15 * MINUTE);
  });
});
