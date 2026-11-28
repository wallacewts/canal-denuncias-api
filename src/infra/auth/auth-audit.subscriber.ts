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
    for (const entry of toAuditEntries(event)) this.write(entry.userId, entry);
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
        resourceType:
          entry.resourceType ??
          (entry.action === AuditAction.ACCESS_DENIED ? AuditResourceType.SYSTEM : AuditResourceType.SESSION),
        resourceId: entry.resourceType === AuditResourceType.USER ? userId : null,
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
  resourceType?: AuditResourceType;
}

const signedIn = (userId: string): AuthAuditEntry => ({
  userId,
  action: AuditAction.AUTH_SIGNED_IN,
  result: AuditResult.SUCCESS,
  metadata: { method: 'password' },
});

/**
 * Registros da trilha para um evento do pacote. O login só conta quando a sessão fica verificada: no `mfa-verified`
 * (desafio). A confirmação do primeiro cadastro no login é registrada pelo serviço de cadastro, que sabe que está no
 * fluxo de entrada (o mesmo evento `mfa-enabled` sai de qualquer confirmação). A senha sozinha nunca é login.
 */
export function toAuditEntries(event: AuthenticationEvent): AuthAuditEntry[] {
  switch (event.type) {
    case 'mfa-verified':
      return event.method === 'recovery-code'
        ? [
            signedIn(event.userId),
            { userId: event.userId, action: AuditAction.AUTH_RECOVERY_CODE_USED, result: AuditResult.SUCCESS },
          ]
        : [signedIn(event.userId)];
    case 'mfa-enabled': {
      const enrolled: AuthAuditEntry = {
        userId: event.userId,
        action: AuditAction.AUTH_MFA_ENROLLED,
        result: AuditResult.SUCCESS,
        metadata: { replaced: event.replaced },
        resourceType: AuditResourceType.USER,
      };
      return [enrolled];
    }
    case 'mfa-failed':
      return [
        {
          userId: event.userId,
          action: AuditAction.AUTH_MFA_FAILED,
          result: AuditResult.FAILURE,
          metadata: { locked: Boolean(event.locked) },
        },
      ];
    case 'sign-out':
      return [
        event.everywhere
          ? {
              userId: event.userId,
              action: AuditAction.AUTH_SESSION_REVOKED,
              result: AuditResult.SUCCESS,
              metadata: { scope: 'all' },
            }
          : { userId: event.userId, action: AuditAction.AUTH_SIGNED_OUT, result: AuditResult.SUCCESS },
      ];
    default:
      return [];
  }
}

/** Primeiro registro do evento (o login, quando houver), usado pelo último login (feature 005). */
export function toAuditEntry(event: AuthenticationEvent): AuthAuditEntry | null {
  return toAuditEntries(event)[0] ?? null;
}
