import { Inject, Injectable } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import type { Env } from '../../config/env.schema.js';
import { AUTH_CLOCK, type AuthClock } from '../../infra/auth/auth-clock.js';
import { AuditAction, AuditResourceType } from '../audit/audit-action.enum.js';
import { AuditService } from '../audit/audit.service.js';
import type { LockoutConfig } from './lockout.js';
import { StaffCredentialsRepository } from './staff-credentials.repository.js';

/** Id que nunca existe (UUID nulo), para a contagem rodar igual em toda falha. */
const NO_USER = '00000000-0000-0000-0000-000000000000';

export type LoginFailureReason = 'UNKNOWN_ACCOUNT' | 'BAD_CREDENTIALS' | 'TEMPORARILY_LOCKED' | 'BLOCKED' | 'DISABLED';

export type CredentialsResult = { ok: true; userId: string } | { ok: false; reason: LoginFailureReason };

/**
 * Verificação de credenciais da equipe (feature 006, R3; promovida do `ExampleCredentials` da feature 004). O hash é
 * sempre verificado (o fictício do pacote quando o e-mail não existe) **antes** de olhar status ou bloqueio: todos os
 * casos de falha levam o mesmo tempo e recebem a mesma resposta. O motivo real só vai para a trilha.
 */
@Injectable()
export class CredentialsService {
  readonly lockout: LockoutConfig;

  constructor(
    private readonly credentials: StaffCredentialsRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
    config: ConfigService<Env, true>,
  ) {
    this.lockout = {
      threshold: config.get('LOGIN_LOCKOUT_THRESHOLD', { infer: true }),
      base: config.get('LOGIN_LOCKOUT_BASE_MINUTES', { infer: true }),
      max: config.get('LOGIN_LOCKOUT_MAX_MINUTES', { infer: true }),
    };
  }

  async verify(email: string, password: string): Promise<CredentialsResult> {
    const found = await this.credentials.findByEmail(email);
    const valid = await this.hasher.verify(password, found?.passwordHash);
    const now = new Date(this.clock.now());

    // Toda falha faz as mesmas consultas numa transação só (contagem e registro; a contagem roda sobre um id que não
    // existe quando não conta): o tempo da resposta não revela se o e-mail existe nem o estado da conta.
    if (!found) return this.fail('UNKNOWN_ACCOUNT', null, null, now);
    if (found.status === UserStatus.BLOCKED) return this.fail('BLOCKED', found.id, null, now);
    if (found.status === UserStatus.DISABLED) return this.fail('DISABLED', found.id, null, now);
    if (found.lockedUntil && found.lockedUntil > now) return this.fail('TEMPORARILY_LOCKED', found.id, null, now);
    if (!valid) return this.fail('BAD_CREDENTIALS', found.id, found.id, now);
    if (this.hasher.needsRehash(found.passwordHash)) {
      await this.credentials.updatePasswordHash(found.id, await this.hasher.hash(password));
    }
    return { ok: true, userId: found.id };
  }

  /** Código errado no desafio soma no mesmo contador do login (FR-003). */
  async registerMfaFailure(userId: string): Promise<void> {
    await this.credentials.registerFailure(userId, this.lockout, new Date(this.clock.now()));
  }

  /** Conta (só quando `countFor` é a conta) e registra na mesma transação. */
  private async fail(
    reason: LoginFailureReason,
    userId: string | null,
    countFor: string | null,
    now: Date,
  ): Promise<CredentialsResult> {
    await this.ds.transaction(async (m) => {
      const counted = await this.credentials.registerFailure(countFor ?? NO_USER, this.lockout, now, m);
      await this.audit.record(
        {
          action: AuditAction.AUTH_LOGIN_FAILED,
          resourceType: AuditResourceType.USER,
          resourceId: userId,
          result: AuditResult.FAILURE,
          metadata: countFor ? { reason, locked: Boolean(counted?.locked) } : { reason },
        },
        m,
      );
    });
    return { ok: false, reason };
  }
}
