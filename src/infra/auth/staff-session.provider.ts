import { Injectable } from '@nestjs/common';
import { AuthenticationRegistry, SessionCookieProvider, type SessionRecord } from '@nestjs/authentication';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import type { StaffUser } from './staff-user.js';

/**
 * Único meio de autenticação da área administrativa (D53): a sessão por cookie. O usuário e os perfis vêm do banco na
 * mesma leitura da sessão (`extra` do `PgSessionStore`); usuário desativado ou bloqueado devolve `null`, o que encerra
 * a sessão na requisição seguinte.
 */
@Injectable()
export class StaffSessionProvider extends SessionCookieProvider<StaffUser> {
  constructor(registry: AuthenticationRegistry) {
    super();
    registry.registerProvider(this, { order: 0 });
  }

  protected validate(session: SessionRecord): StaffUser | null {
    const user = (session.extra as { user?: StaffUser } | undefined)?.user;
    if (!user || user.status !== UserStatus.ACTIVE) return null;
    return { ...user, mfaVerified: session.mfa === 'verified' };
  }
}
