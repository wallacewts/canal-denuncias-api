import type { Request } from 'express';
import { Role } from '../../src/common/enums/role.enum.js';
import type { AuthIdentity, StaffIdentity } from '../../src/infra/auth/auth-identity.port.js';

/**
 * Identidade SÓ DE TESTE (nunca importada por `src/`; o teste de convenção falha se for). Lê o cabeçalho
 * `x-test-identity: <uuid>:<PERFIL>[,<PERFIL>]`. Sem o cabeçalho, ou com valor malformado, não há identidade.
 */
export const TEST_IDENTITY_HEADER = 'x-test-identity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROLES = new Set<string>(Object.values(Role));

export class FakeIdentity implements AuthIdentity {
  resolve(request: Request): Promise<StaffIdentity | null> {
    const raw = request.headers[TEST_IDENTITY_HEADER];
    if (typeof raw !== 'string') return Promise.resolve(null);
    const [userId, roleList = ''] = raw.split(':');
    const roles = roleList.split(',').filter((r) => ROLES.has(r)) as Role[];
    if (!userId || !UUID.test(userId) || roles.length === 0) return Promise.resolve(null);
    return Promise.resolve({ userId, roles });
  }
}

/** Valor do cabeçalho de teste para um membro com os perfis informados. */
export function testIdentity(userId: string, ...roles: Role[]): Record<string, string> {
  return { [TEST_IDENTITY_HEADER]: `${userId}:${roles.join(',')}` };
}
