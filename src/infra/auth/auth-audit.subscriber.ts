import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuthenticationEvents, type AuthenticationEvent } from '@nestjs/authentication';
import { AuthorizationEvents, type AuthorizationEvent } from '@nestjs/authorization';
import type { Subscription } from 'rxjs';
import { ActorType } from '../../common/enums/actor-type.enum.js';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { AuditAction, AuditResourceType } from '../../modules/audit/audit-action.enum.js';
import { AuditContext, type ActorContext } from '../../modules/audit/audit-context.js';
import { AuditService } from '../../modules/audit/audit.service.js';

/**
 * Leva os eventos de autenticação para a trilha (R7, FR-015), sem senha, código, token nem id de sessão:
 * - login verificado (sessão sem MFA pendente, ou MFA aceito) → `AUTH_SIGNED_IN`;
 * - código recusado → `AUTH_MFA_FAILED`;
 * - saída → `AUTH_SIGNED_OUT`; saída de todos os lugares → `AUTH_SESSION_REVOKED`;
 * - negação de permissão (403) → `ACCESS_DENIED`, só com o nome da política e da habilidade (FR-020).
 *
 * O evento chega dentro da requisição (o contexto do ator está aberto pelo interceptor); o usuário vem do evento,
 * porque nas rotas de entrar ainda não há identidade. Fora de requisição, o ator é a equipe sem IP.
 */
@Injectable()
export class AuthAuditSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthAuditSubscriber.name);
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly events: AuthenticationEvents,
    private readonly authorizationEvents: AuthorizationEvents,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      this.events.events$.subscribe((event) => this.handle(event)),
      this.authorizationEvents.events$.subscribe((event) => this.handleDenied(event)),
    );
  }

  onModuleDestroy(): void {
    for (const s of this.subscriptions) s.unsubscribe();
  }

  /**
   * A negação pelo guard acontece antes do interceptor que abre o contexto: aí o ator vem do usuário do evento, sem
   * IP. Negações em serviços (`authorize()`) acontecem dentro do contexto e levam o IP da requisição.
   */
  private handleDenied(event: AuthorizationEvent): void {
    if (event.type !== 'denied' || event.reason !== 'forbidden') return;
    const userId = (event.user as { id?: unknown } | null)?.id;
    if (typeof userId !== 'string') return;
    this.write(userId, {
      userId,
      action: AuditAction.ACCESS_DENIED,
      result: AuditResult.DENIED,
      metadata: { policy: event.policy, ability: event.ability },
    });
  }

  private handle(event: AuthenticationEvent): void {
    const entry = toAuditEntry(event);
    if (entry) this.write(entry.userId, entry);
  }

  private write(userId: string, entry: AuthAuditEntry): void {
    const current = AuditContext.current();
    const actor: ActorContext = {
      actorType: ActorType.STAFF,
      actorUserId: userId,
      ip: current?.actorType === ActorType.STAFF ? current.ip : null,
      userAgent: current?.actorType === ActorType.STAFF ? current.userAgent : null,
    };
    AuditContext.run(actor, () =>
      this.audit.record({
        action: entry.action,
        // A negação não carrega o registro (só nomes de código): o recurso é registrado como sistema.
        resourceType: entry.action === AuditAction.ACCESS_DENIED ? AuditResourceType.SYSTEM : AuditResourceType.SESSION,
        resourceId: null,
        result: entry.result,
        metadata: entry.metadata,
      }),
    ).catch((error: unknown) => {
      // Só o nome do erro: a mensagem poderia carregar dado da requisição.
      this.logger.error({ error: error instanceof Error ? error.name : 'unknown' }, 'Falha ao auditar autenticação');
    });
  }
}

interface AuthAuditEntry {
  userId: string;
  action: AuditAction;
  result: AuditResult;
  metadata?: Record<string, unknown>;
}

export function toAuditEntry(event: AuthenticationEvent): AuthAuditEntry | null {
  switch (event.type) {
    case 'sign-in':
      // Sessão com segundo fator pendente ainda não é login: ele fecha no `mfa-verified`.
      if (event.mfa === 'pending' || event.method !== 'password') return null;
      return {
        userId: event.userId,
        action: AuditAction.AUTH_SIGNED_IN,
        result: AuditResult.SUCCESS,
        metadata: { method: 'password' },
      };
    case 'mfa-verified':
      return {
        userId: event.userId,
        action: AuditAction.AUTH_SIGNED_IN,
        result: AuditResult.SUCCESS,
        metadata: { method: 'password' },
      };
    case 'mfa-failed':
      return {
        userId: event.userId,
        action: AuditAction.AUTH_MFA_FAILED,
        result: AuditResult.FAILURE,
        metadata: { locked: Boolean(event.locked) },
      };
    case 'sign-out':
      return event.everywhere
        ? {
            userId: event.userId,
            action: AuditAction.AUTH_SESSION_REVOKED,
            result: AuditResult.SUCCESS,
            metadata: { scope: 'all' },
          }
        : { userId: event.userId, action: AuditAction.AUTH_SIGNED_OUT, result: AuditResult.SUCCESS };
    default:
      return null;
  }
}
