import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { ActorType } from '../../common/enums/actor-type.enum.js';
import { ADMIN_OPEN_METADATA, API_AREA_METADATA, type ApiArea } from '../../common/http/route-decorators.js';
import type { RequestWithIdentity } from '../../infra/auth/admin-identity.guard.js';
import { AuditContext, type ActorContext } from './audit-context.js';

const USER_AGENT_MAX = 255;

/**
 * Abre o contexto do ator para cada requisição, pela área do controller (D46):
 * - `public` → REPORTER, sem usuário, IP nem user-agent. Os cabeçalhos da requisição nunca são lidos (princípio I).
 * - `admin` → STAFF, com a identidade resolvida pelo `AdminIdentityGuard`, o IP real (trust proxy) e o user-agent.
 *   Nas rotas abertas de propósito (`OpenAdminRoute`: entrar e segundo fator), STAFF ainda sem usuário.
 * Rotas fora das duas áreas (health, docs) não abrem contexto: um registro feito nelas é recusado.
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const area = this.reflector.get<ApiArea | undefined>(API_AREA_METADATA, context.getClass());
    const open = this.reflector.getAllAndOverride<boolean | undefined>(ADMIN_OPEN_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    const actor = area
      ? this.actorFor(area, context.switchToHttp().getRequest<RequestWithIdentity>(), Boolean(open))
      : null;
    if (!actor) return next.handle();
    // O handler só roda na inscrição: o contexto precisa envolver a inscrição, não só a criação do Observable.
    return new Observable((subscriber) => AuditContext.run(actor, () => next.handle().subscribe(subscriber)));
  }

  private actorFor(area: ApiArea, request: RequestWithIdentity, open: boolean): ActorContext | null {
    if (area === 'public') {
      return { actorType: ActorType.REPORTER, actorUserId: null, ip: null, userAgent: null };
    }
    const identity = request.staffIdentity;
    // Rota administrativa aberta (entrar, segundo fator): equipe ainda sem usuário; quem registra o login informa o
    // usuário a partir do evento do pacote (auth-audit.subscriber).
    if (!identity && !open) return null;
    const userAgent = request.get('user-agent');
    return {
      actorType: ActorType.STAFF,
      actorUserId: identity?.userId ?? null,
      ip: request.ip ?? null,
      userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
    };
  }
}
