import { DataSource } from 'typeorm';
import { CliCommandsModule } from '../../src/cli/cli-commands.module.js';
import { CliOutput } from '../../src/cli/cli-output.js';
import { CreateAdminCommand } from '../../src/cli/create-admin.command.js';
import { PasswordPrompt } from '../../src/cli/password-prompt.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

const SENHA = 'frase senha forte XQZ 2026';

/** Prompt falso: devolve as respostas na ordem. */
class FakePrompt {
  answers: string[] = [];
  asked = 0;
  async ask(): Promise<string> {
    this.asked += 1;
    const next = this.answers.shift();
    if (next === undefined) throw new Error('sem mais respostas');
    return next;
  }
}

class CapturedOutput {
  lines: string[] = [];
  info(message: string) {
    this.lines.push(message);
  }
  error(message: string) {
    this.lines.push(message);
  }
}

describe('create-admin (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;
  const prompt = new FakePrompt();
  const output = new CapturedOutput();
  let command: CreateAdminCommand;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [CliCommandsModule],
      overrides: [
        { provide: PasswordPrompt, useValue: prompt },
        { provide: CliOutput, useValue: output },
      ],
    });
    ds = t.app.get(DataSource);
    command = t.app.get(CreateAdminCommand);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(() => {
    output.lines = [];
    prompt.asked = 0;
  });

  const run = (email: string, force = false, answers = [SENHA, SENHA]) => {
    prompt.answers = [...answers];
    return command.execute({ name: 'Administradora', email, force });
  };

  it('cria o admin ACTIVE com perfil ADMIN, sem MFA, hash scrypt e auditoria SYSTEM', async () => {
    expect(await run('admin@teste.local')).toBe(0);

    const [user] = await ds.query(
      `SELECT u.id, u.status, u.mfa_enabled_at, u.password_hash, array_agg(r.role::text) AS roles
         FROM users u JOIN user_roles r ON r.user_id = u.id WHERE u.email = 'admin@teste.local' GROUP BY u.id`,
    );
    expect(user.status).toBe('ACTIVE');
    expect(user.mfa_enabled_at).toBeNull();
    expect(user.roles).toEqual(['ADMIN']);
    expect(user.password_hash).toMatch(/^\$scrypt\$ln=10,/);

    const [log] = await ds.query(`SELECT * FROM audit_logs WHERE action = 'USER_CREATED' AND resource_id = $1`, [
      user.id,
    ]);
    expect(log).toMatchObject({ actor_type: 'SYSTEM', actor_user_id: null, ip: null, result: 'SUCCESS' });
    expect(log.metadata).toEqual({ roles: ['ADMIN'], forced: false });
    expect(JSON.stringify(log)).not.toContain('admin@teste.local');
  });

  it('recusa um segundo admin sem --force', async () => {
    expect(await run('outro@teste.local')).toBe(1);
    expect(output.lines.join('\n')).toMatch(/--force/);
    const [{ count }] = await ds.query(`SELECT count(*)::int AS count FROM users WHERE email = 'outro@teste.local'`);
    expect(count).toBe(0);
  });

  it('com --force cria e audita forced: true', async () => {
    expect(await run('forcado@teste.local', true)).toBe(0);
    const [log] = await ds.query(
      `SELECT l.metadata FROM audit_logs l JOIN users u ON u.id::text = l.resource_id
        WHERE u.email = 'forcado@teste.local' AND l.action = 'USER_CREATED'`,
    );
    expect(log.metadata).toEqual({ roles: ['ADMIN'], forced: true });
  });

  it.each([
    ['e-mail inválido', 'nao-e-email'],
    ['e-mail vazio', ''],
  ])('%s sai com código 1 sem pedir senha', async (_caso, email) => {
    expect(await run(email, true)).toBe(1);
    expect(prompt.asked).toBe(0);
  });

  it('e-mail já cadastrado sai com código 1', async () => {
    expect(await run('ADMIN@teste.local', true)).toBe(1);
    expect(output.lines.join('\n')).toMatch(/já cadastrado/);
  });

  it('senha fraca ou confirmação diferente é pedida de novo, até 3 tentativas', async () => {
    // Senha recusada pela política não pede confirmação: 'curta' (1), 'password1234' (2), SENHA + confirmação errada (4).
    expect(await run('tentativas@teste.local', true, ['curta', 'password1234', SENHA, 'diferente da primeira'])).toBe(
      1,
    );
    expect(prompt.asked).toBe(4);
    expect(output.lines.join('\n')).toMatch(/tentativas/);
    expect(await run('ok-na-segunda@teste.local', true, ['XQZ', SENHA, SENHA])).toBe(0);
  });

  it('a saída e os logs nunca contêm a senha nem o hash', async () => {
    await run('silencio@teste.local', true, ['XQZ', SENHA, SENHA]);
    const text = `${output.lines.join('\n')}\n${t.logs.text()}`;
    expect(text).not.toContain('XQZ');
    expect(text).not.toContain(SENHA);
    expect(text).not.toContain('$scrypt$');
  });

  it('duas execuções simultâneas sem --force criam um único admin', async () => {
    await ds.query(`UPDATE users SET status = 'DISABLED'`);
    prompt.answers = [SENHA, SENHA, SENHA, SENHA];
    const results = await Promise.all([
      command.execute({ name: 'A', email: 'corrida1@teste.local', force: false }),
      command.execute({ name: 'B', email: 'corrida2@teste.local', force: false }),
    ]);
    expect(results.sort()).toEqual([0, 1]);
    const [{ count }] = await ds.query(
      `SELECT count(*)::int AS count FROM users u JOIN user_roles r ON r.user_id = u.id
        WHERE r.role = 'ADMIN' AND u.status = 'ACTIVE'`,
    );
    expect(count).toBe(1);
  });
});
