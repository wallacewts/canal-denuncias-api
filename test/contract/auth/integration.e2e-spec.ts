import { MfaService } from '@nestjs/authentication';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { CliCommandsModule } from '../../../src/cli/cli-commands.module.js';
import { CliOutput } from '../../../src/cli/cli-output.js';
import { CreateAdminCommand } from '../../../src/cli/create-admin.command.js';
import { PasswordPrompt } from '../../../src/cli/password-prompt.js';
import { AuditFixtureModule } from '../../support/fixtures/audit-fixture.module.js';
import { createTestApp, type TestApp } from '../../support/test-app.js';
import { signInFully, totp } from './example/auth-helpers.js';
import { ExampleAuthModule } from './example/example.module.js';

/**
 * Encaixe com o que já existe (US4, T029, FR-013, FR-014): o administrador do `create-admin` entra sem migração de
 * hash, a sessão alimenta a `AUTH_IDENTITY` e a trilha registra a equipe pela sessão; sem sessão continua 401 (D47);
 * a área pública ignora o cookie de sessão.
 */
describe('Encaixe da autenticação com create-admin, AUTH_IDENTITY e auditoria (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;
  const SENHA = 'frase senha forte XQZ 2026';
  const REPORT = '01900000-0000-7000-8000-0000000000aa';
  const server = () => t.app.getHttpServer();
  let admin: { id: string; email: string; hashBefore: string; cookie: string };

  beforeAll(async () => {
    const answers = [SENHA, SENHA];
    t = await createTestApp({
      vault: 'api',
      imports: [CliCommandsModule, AuditFixtureModule, ExampleAuthModule],
      overrides: [
        { provide: PasswordPrompt, useValue: { ask: async () => answers.shift() } },
        { provide: CliOutput, useValue: { info: () => undefined, error: () => undefined } },
      ],
    });
    ds = t.app.get<DataSource>(getDataSourceToken());

    const email = 'encaixe@teste.local';
    expect(await t.app.get(CreateAdminCommand).execute({ name: 'Encaixe', email, force: true })).toBe(0);
    const [row] = (await ds.query(`SELECT id, password_hash FROM users WHERE email = $1`, [email])) as Array<{
      id: string;
      password_hash: string;
    }>;
    // O create-admin não cadastra o TOTP: o primeiro acesso cadastra (feature 04-auth). Aqui, direto pelo pacote.
    const mfa = t.app.get(MfaService);
    const { uri } = await mfa.enroll(row.id, email);
    const secret = new URL(uri).searchParams.get('secret')!;
    expect(await mfa.confirm(row.id, totp(secret, Date.now(), -1))).toBe(true);
    const cookie = await signInFully(t.app, { id: row.id, email, password: SENHA, secret }, Date.now());
    admin = { id: row.id, email, hashBefore: row.password_hash, cookie };
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('o hash do create-admin é aceito no login sem migração', async () => {
    const [row] = (await ds.query(`SELECT password_hash FROM users WHERE id = $1`, [admin.id])) as Array<{
      password_hash: string;
    }>;
    expect(row.password_hash).toBe(admin.hashBefore);
    expect(row.password_hash).toMatch(/^\$scrypt\$/);
    const me = await request(server()).get('/api/admin/v1/example-auth/me').set('Cookie', admin.cookie).expect(200);
    expect(me.body).toEqual({ id: admin.id });
  });

  it('rota @AdminApi auditada grava ator equipe com o id do usuário da sessão e o IP', async () => {
    await request(server()).get(`/api/admin/v1/audit-fixtures/items/${REPORT}`).set('Cookie', admin.cookie).expect(200);
    const rows = (await ds.query(
      `SELECT actor_type::text, actor_user_id::text, host(ip) AS ip, result::text FROM audit_logs
        WHERE action = 'REPORT_VIEWED' AND resource_id = $1`,
      [REPORT],
    )) as Array<{ actor_type: string; actor_user_id: string; ip: string | null; result: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_type: 'STAFF', actor_user_id: admin.id, result: 'SUCCESS' });
    expect(rows[0].ip).not.toBeNull();
  });

  it('sem sessão, ou com cookie inválido, a área administrativa continua 401 (D47)', async () => {
    await request(server()).get(`/api/admin/v1/audit-fixtures/items/${REPORT}`).expect(401);
    await request(server())
      .get(`/api/admin/v1/audit-fixtures/items/${REPORT}`)
      .set('Cookie', '__Host-sid=XQZ')
      .expect(401);
  });

  it('a área pública não lê o cookie de sessão: o ator continua denunciante, sem usuário nem IP', async () => {
    const res = await request(server())
      .post('/api/public/v1/audit-fixtures/record')
      .set('Cookie', admin.cookie)
      .expect(201);
    expect(([] as string[]).concat(res.headers['set-cookie'] ?? [])).toHaveLength(0);
    const [row] = (await ds.query(`SELECT actor_type::text, actor_user_id, ip FROM audit_logs WHERE id = $1`, [
      (res.body as { id: string }).id,
    ])) as Array<{ actor_type: string; actor_user_id: string | null; ip: string | null }>;
    expect(row).toEqual({ actor_type: 'REPORTER', actor_user_id: null, ip: null });
  });
});
