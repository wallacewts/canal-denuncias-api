import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { createStaff, sessionCookie } from '../contract/auth/example/auth-helpers.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import { createUsersApp, staffWithSession } from './support.js';

/** US1 (T015, FR-006): o último login é gravado quando a entrada termina (senha e MFA). */
describe('Equipe: último login (e2e)', () => {
  let t: TestApp & { clock: TestClock };
  let ds: DataSource;

  beforeAll(async () => {
    t = await createUsersApp();
    ds = t.app.get<DataSource>(getDataSourceToken());
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const lastLogin = async (id: string) =>
    (
      (await ds.query(`SELECT last_login_at FROM users WHERE id = $1`, [id])) as Array<{ last_login_at: Date | null }>
    )[0].last_login_at;

  const waitFor = async (id: string) => {
    const end = Date.now() + 3_000;
    let value = await lastLogin(id);
    while (!value && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 50));
      value = await lastLogin(id);
    }
    return value;
  };

  it('só a senha (MFA pendente) não grava', async () => {
    const staff = await createStaff(t.app, [Role.ANALYST], { nowMs: t.clock.now() });
    const res = await request(t.app.getHttpServer())
      .post('/api/admin/v1/example-auth/sign-in')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    expect(sessionCookie(res)).not.toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    expect(await lastLogin(staff.id)).toBeNull();
  });

  it('senha e MFA gravam o horário do relógio da autenticação', async () => {
    const before = t.clock.now();
    const staff = await staffWithSession(t, Role.ANALYST);
    const value = await waitFor(staff.id);
    expect(value).not.toBeNull();
    expect(value!.getTime()).toBeGreaterThanOrEqual(before);
    expect(value!.getTime()).toBeLessThanOrEqual(t.clock.now());
  });
});
