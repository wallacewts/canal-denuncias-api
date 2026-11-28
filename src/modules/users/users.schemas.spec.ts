import { Role } from '../../common/enums/role.enum.js';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateNameSchema,
  updateRolesSchema,
  updateStatusSchema,
} from './users.schemas.js';

const valid = { name: 'Ana', email: 'ana@empresa.test', roles: [Role.ANALYST] };

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }): string {
  return JSON.stringify(result.error?.issues.map((i) => i.message) ?? []);
}

describe('Schemas de entrada da equipe (feature 005, T011)', () => {
  it('cadastro válido normaliza o e-mail (espaços nas pontas)', () => {
    const parsed = createUserSchema.parse({ ...valid, email: '  Ana@Empresa.test ' });
    expect(parsed.email).toBe('Ana@Empresa.test');
    expect(parsed.name).toBe('Ana');
  });

  it.each([
    ['campo extra', { ...valid, status: 'ACTIVE' }],
    ['senha no cadastro', { ...valid, password: 'XQZ' }],
    ['sem perfil', { ...valid, roles: [] }],
    ['perfil repetido', { ...valid, roles: [Role.ANALYST, Role.ANALYST] }],
    ['perfil inexistente', { ...valid, roles: ['XQZ'] }],
    ['seis perfis', { ...valid, roles: [...Object.values(Role), Role.ADMIN] }],
    ['nome vazio', { ...valid, name: '' }],
    ['nome só com espaços', { ...valid, name: '   ' }],
    ['nome longo', { ...valid, name: 'a'.repeat(121) }],
    ['e-mail inválido', { ...valid, email: 'XQZ' }],
    ['e-mail longo', { ...valid, email: `${'a'.repeat(250)}@x.io` }],
  ])('recusa %s sem ecoar o valor', (_caso, input) => {
    const result = createUserSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(messages(result)).not.toContain('XQZ');
  });

  it('nome: até 120 caracteres, sem campos extras', () => {
    expect(updateNameSchema.parse({ name: ' Ana Maria ' }).name).toBe('Ana Maria');
    expect(updateNameSchema.safeParse({ name: 'Ana', email: 'x@y.z' }).success).toBe(false);
  });

  it('status só entre os três valores', () => {
    expect(updateStatusSchema.parse({ status: 'BLOCKED' }).status).toBe('BLOCKED');
    expect(updateStatusSchema.safeParse({ status: 'DELETED' }).success).toBe(false);
  });

  it('perfis: 1 a 5, sem repetição', () => {
    expect(updateRolesSchema.parse({ roles: [Role.ADMIN, Role.DPO] }).roles).toEqual([Role.ADMIN, Role.DPO]);
    expect(updateRolesSchema.safeParse({ roles: [] }).success).toBe(false);
    expect(updateRolesSchema.safeParse({ roles: [Role.DPO, Role.DPO] }).success).toBe(false);
  });

  it('listagem: filtros opcionais e paginação; desconhecido é recusado', () => {
    expect(listUsersQuerySchema.parse({}).limit).toBe(20);
    expect(listUsersQuerySchema.parse({ status: 'ACTIVE', role: 'ADMIN', limit: '10' })).toMatchObject({
      status: 'ACTIVE',
      role: 'ADMIN',
      limit: 10,
    });
    expect(listUsersQuerySchema.safeParse({ q: 'XQZ' }).success).toBe(false);
    expect(listUsersQuerySchema.safeParse({ after: 'XQZ' }).success).toBe(false);
    expect(listUsersQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});
