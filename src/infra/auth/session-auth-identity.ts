import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthIdentity, StaffIdentity } from './auth-identity.port.js';
import type { StaffUser } from './staff-user.js';

/**
 * Porta de identidade da área administrativa (D47) alimentada pela sessão real (D53). O guard global do pacote roda
 * antes, autentica a sessão (verificada com MFA), recarrega o usuário do banco e o deixa em `request.user`; aqui só se
 * traduz para a identidade que o `AdminIdentityGuard` e a auditoria usam. Sem usuário, `null` (401).
 *
 * Lê `request.user`, e não o `AuthenticationContext`: o contexto assíncrono do pacote ainda não está aberto na fase
 * dos guards.
 */
@Injectable()
export class SessionAuthIdentity implements AuthIdentity {
  resolve(request: Request): Promise<StaffIdentity | null> {
    const user = (request as Request & { user?: StaffUser | null }).user;
    return Promise.resolve(user ? { userId: user.id, roles: user.roles } : null);
  }
}
