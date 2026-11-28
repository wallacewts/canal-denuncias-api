import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ADMIN_OPEN_METADATA, API_AREA_METADATA, type ApiArea } from '../../common/http/route-decorators.js';
import { AUTH_IDENTITY, type AuthIdentity, type StaffIdentity } from './auth-identity.port.js';

/** Identidade resolvida pelo guard, lida depois pelo contexto da auditoria. */
export type RequestWithIdentity = Request & { staffIdentity?: StaffIdentity };

/**
 * Área administrativa negada por padrão (D47, princípio IV): sem identidade, 401. A permissão de cada rota fica com a
 * declaração `@Can()` e as políticas do access-control (feature 007), inclusive as rotas da trilha (`AuditPolicy`).
 */
@Injectable()
export class AdminIdentityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_IDENTITY) private readonly identity: AuthIdentity,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const area = this.reflector.get<ApiArea | undefined>(API_AREA_METADATA, context.getClass());
    if (area !== 'admin') return true;
    // Rotas administrativas abertas de propósito (entrar, segundo fator) não têm identidade ainda.
    const open = this.reflector.getAllAndOverride<boolean | undefined>(ADMIN_OPEN_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (open) return true;

    const request = context.switchToHttp().getRequest<RequestWithIdentity>();
    const identity = await this.identity.resolve(request);
    if (!identity) throw new UnauthorizedException();
    request.staffIdentity = identity;
    return true;
  }
}
