import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuthenticationEvents } from '@nestjs/authentication';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Subscription } from 'rxjs';
import type { DataSource } from 'typeorm';
import { AUTH_CLOCK, type AuthClock } from '../../infra/auth/auth-clock.js';
import { toAuditEntries } from '../../infra/auth/auth-audit.subscriber.js';
import { AuditAction } from '../audit/audit-action.enum.js';

/**
 * Grava `users.last_login_at` quando a entrada termina (feature 005, research R9): o mesmo critério do
 * `AUTH_SIGNED_IN` (MFA aceito, ou primeiro cadastro do autenticador confirmado; feature 006). Erro só é logado pelo
 * nome.
 */
@Injectable()
export class LastLoginSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LastLoginSubscriber.name);
  private subscription?: Subscription;

  constructor(
    private readonly events: AuthenticationEvents,
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
  ) {}

  onModuleInit(): void {
    this.subscription = this.events.events$.subscribe((event) => {
      const entry = toAuditEntries(event).find((e) => e.action === AuditAction.AUTH_SIGNED_IN);
      if (!entry) return;
      this.ds
        .query(`UPDATE users SET last_login_at = $2 WHERE id = $1`, [entry.userId, new Date(this.clock.now())])
        .catch((error: unknown) => {
          this.logger.error(
            { err: { type: error instanceof Error ? error.name : typeof error } },
            'Falha no último login',
          );
        });
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
