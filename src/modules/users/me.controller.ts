import { Get, Inject, UnauthorizedException } from '@nestjs/common';
import { CurrentSession, CurrentUser, type SessionRecord } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiOkResponse } from '@nestjs/swagger';
import { AdminApi } from '../../common/http/route-decorators.js';
import { AUTH_CLOCK, type AuthClock } from '../../infra/auth/auth-clock.js';
import { SESSION_IDLE_TTL_MS, SESSION_TOUCH_INTERVAL_MS } from '../../infra/auth/session-policy.js';
import type { StaffUser } from '../../infra/auth/staff-user.js';
import { abilitiesFor } from '../access-control/abilities.js';
import { currentUserOpenApiSchema, type CurrentUserView } from './me.schema.js';
import { UsersRepository } from './users.repository.js';
import { sortRoles } from './users.view.js';

/**
 * Meu perfil (USERS-07). Qualquer pessoa com sessão verificada; não é auditado. A expiração por inatividade parte do
 * último uso como fica gravado depois desta requisição: o pacote regrava quando passou o intervalo de toque (então o
 * último uso é agora), senão vale o gravado. Nunca promete mais que o banco; pode vir até 1 min antes do real.
 */
@AdminApi('me')
export class MeController {
  constructor(
    private readonly users: UsersRepository,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
  ) {}

  @Can.Anyone()
  @ApiOkResponse({
    description: 'Meu perfil, no formato do CurrentUser do backoffice.',
    schema: currentUserOpenApiSchema(),
  })
  @Get()
  async me(@CurrentUser() current: StaffUser, @CurrentSession() session: SessionRecord): Promise<CurrentUserView> {
    const user = await this.users.findById(current.id);
    if (!user) throw new UnauthorizedException();
    const now = this.clock.now();
    const stored = session.lastActiveAt.getTime();
    const lastActive = now - stored >= SESSION_TOUCH_INTERVAL_MS ? now : stored;
    const roles = sortRoles(user.roles.map((r) => r.role));
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      roles,
      mfaEnabledAt: user.mfaEnabledAt?.toISOString() ?? null,
      passwordChangeRequired: user.passwordChangedAt === null,
      abilities: abilitiesFor(roles),
      idleExpiresAt: new Date(lastActive + SESSION_IDLE_TTL_MS).toISOString(),
      absoluteExpiresAt: session.expiresAt.toISOString(),
    };
  }
}
