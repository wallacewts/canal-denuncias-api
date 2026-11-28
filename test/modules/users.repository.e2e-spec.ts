import { DomainConflictError } from '../../src/common/http/domain-error.js';
import { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { UsersRepository } from '../../src/modules/users/users.repository.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

describe('UsersRepository (e2e)', () => {
  let t: TestApp;
  let users: UsersRepository;

  beforeAll(async () => {
    t = await createTestApp();
    users = t.app.get(UsersRepository);
  });

  afterAll(async () => {
    await t.close();
  });

  const create = (email: string) =>
    users.createWithRoles({ name: 'Pessoa', email, passwordHash: '$scrypt$fake', roles: [Role.ADMIN, Role.DPO] });

  it('cria o usuário com perfis e devolve sem hash nem segredo de MFA', async () => {
    const user = await create('a@teste.local');
    expect(user.roles.map((r) => r.role).sort()).toEqual([Role.ADMIN, Role.DPO]);
    expect(user.passwordHash).toBeUndefined();
    expect(user.mfaSecretEnc).toBeUndefined();
    expect(JSON.stringify(user)).not.toContain('$scrypt$');
  });

  it('findById devolve o usuário com perfis e sem hash', async () => {
    const created = await create('b@teste.local');
    const found = await users.findById(created.id);
    expect(found?.roles).toHaveLength(2);
    expect(JSON.stringify(found)).not.toContain('$scrypt$');
  });

  it('só findCredentialsByEmail devolve o hash, e o e-mail não diferencia maiúsculas', async () => {
    await create('c@teste.local');
    const credentials = await users.findCredentialsByEmail('C@TESTE.LOCAL');
    expect(credentials?.passwordHash).toBe('$scrypt$fake');
    expect(JSON.stringify(credentials?.user)).not.toContain('$scrypt$');
    expect(await users.findCredentialsByEmail('ninguem@teste.local')).toBeNull();
  });

  it('e-mail repetido vira 409 pela constraint, sem consulta prévia e sem deixar usuário pela metade', async () => {
    await create('d@teste.local');
    const ds = t.app.get(DataSource);
    const error = await create('D@teste.local').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainConflictError);
    expect((error as DomainConflictError).getStatus()).toBe(409);
    expect((error as DomainConflictError).code).toBe('EMAIL_ALREADY_REGISTERED');
    expect((error as Error).message).not.toContain('d@teste.local');
    const [{ count }] = await ds.query(`SELECT count(*)::int AS count FROM users WHERE email = 'd@teste.local'`);
    expect(count).toBe(1);
  });

  it('conta administradores ativos', async () => {
    const before = await users.countActiveAdmins();
    await create('e@teste.local');
    expect(await users.countActiveAdmins()).toBe(before + 1);
  });
});
