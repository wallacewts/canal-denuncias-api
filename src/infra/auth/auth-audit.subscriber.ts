import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuthenticationEvents, type AuthenticationEvent } from '@nestjs/authentication';
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
 * - saída → `AUTH_SIGNED_OUT`; saída de todos os lugares → `AUTH_SESSION_REVOKED`.
 *
 * O evento chega dentro da requisição (o contexto do ator está aberto pelo interceptor); o usuário vem do evento,
 * porque nas rotas de entrar ainda não há identidade. Fora de requisição, o ator é a equipe sem IP.
 */
@Injectable()
export class AuthAuditSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthAuditSubscriber.name);
  private subscription?: Subscription;

  constructor(
    private readonly events: AuthenticationEvents,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.subscription = this.events.events$.subscribe((event) => this.handle(event));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private handle(event: AuthenticationEvent): void {
    const entry = toAuditEntry(event);
    if (!entry) return;
    const current = AuditContext.current();
    const actor: ActorContext = {
      actorType: ActorType.STAFF,
      actorUserId: entry.userId,
      ip: current?.actorType === ActorType.STAFF ? current.ip : null,
      userAgent: current?.actorType === ActorType.STAFF ? current.userAgent : null,
    };
    AuditContext.run(actor, () =>
      this.audit.record({
        action: entry.action,
        resourceType: AuditResourceType.SESSION,
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
