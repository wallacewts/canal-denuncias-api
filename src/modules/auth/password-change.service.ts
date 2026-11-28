import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PasswordHasher, SessionService, SignInService, type SessionRecord } from '@nestjs/authentication';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { DomainError } from '../../common/http/domain-error.js';
import { AUTH_CLOCK, type AuthClock } from '../../infra/auth/auth-clock.js';
import { PgSessionStore } from '../../infra/auth/stores/pg-session.store.js';
import { AuditAction, AuditResourceType } from '../audit/audit-action.enum.js';
import { AuditService } from '../audit/audit.service.js';
import type { PasswordChangeInput, StepResponse } from './auth.schemas.js';
import { nextStepFor } from './next-step.js';
import { checkPasswordPolicy, PASSWORD_POLICY_CODES } from './password/password-policy.js';
import { sessionExpiry } from './session-expiry.js';

const MAX_CURRENT_PASSWORD_ERRORS = 5;

/**
 * Troca da própria senha (AUTH-05, feature 006, R6 e R7). Política primeiro (erro de política não conta); senha atual
 * errada conta na própria sessão e o 5º erro encerra a sessão (429); sucesso troca o hash, encerra as outras sessões e
 * troca o id da atual. Nenhuma resposta, log ou registro repete a senha.
 */
@Injectable()
export class PasswordChangeService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly hasher: PasswordHasher,
    private readonly sessionsStore: PgSessionStore,
    private readonly sessions: SessionService,
    private readonly signIn: SignInService,
    private readonly audit: AuditService,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
  ) {}

  async change(userId: string, session: SessionRecord, input: PasswordChangeInput): Promise<StepResponse> {
    const policy = checkPasswordPolicy(input.newPassword);
    if (!policy.ok) {
      throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, PASSWORD_POLICY_CODES[policy.reason], policy.message);
    }
    const [row] = (await this.ds.query(`SELECT password_hash FROM users WHERE id = $1`, [userId])) as Array<{
      password_hash: string;
    }>;
    if (!(await this.hasher.verify(input.currentPassword, row?.password_hash))) {
      return this.wrongCurrent(userId, session.id);
    }
    if (input.newPassword === input.currentPassword) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PASSWORD_SAME_AS_CURRENT',
        'A senha nova precisa ser diferente da atual.',
      );
    }

    const hash = await this.hasher.hash(input.newPassword);
    const now = new Date(this.clock.now());
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE users SET password_hash = $2, password_changed_at = $3 WHERE id = $1`, [userId, hash, now]);
      await m.query(`UPDATE sessions SET password_change_failures = 0 WHERE id = $1`, [session.id]);
      await this.audit.record(
        {
          action: AuditAction.AUTH_PASSWORD_CHANGED,
          resourceType: AuditResourceType.USER,
          resourceId: userId,
          result: AuditResult.SUCCESS,
        },
        m,
      );
    });
    await this.sessions.revokeAll(userId, { except: session.id });
    const rotated = await this.signIn.rotateSession();
    const current = rotated?.session ?? session;
    return {
      nextStep: nextStepFor({ mfa: current.mfa, passwordChangeRequired: false }),
      ...sessionExpiry(current, this.clock.now()),
    };
  }

  private async wrongCurrent(userId: string, sessionId: string): Promise<never> {
    const attempt = await this.sessionsStore.registerPasswordChangeFailure(sessionId);
    if (attempt === null) throw this.ended();
    const locked = attempt >= MAX_CURRENT_PASSWORD_ERRORS;
    await this.audit.record({
      action: AuditAction.AUTH_PASSWORD_CHANGE_FAILED,
      resourceType: AuditResourceType.USER,
      resourceId: userId,
      result: AuditResult.FAILURE,
      metadata: { reason: 'CURRENT_PASSWORD_INVALID', attempt, locked },
    });
    if (locked) {
      await this.signIn.signOut();
      throw this.ended();
    }
    throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'CURRENT_PASSWORD_INVALID', 'Senha atual incorreta.');
  }

  private ended(): DomainError {
    return new DomainError(
      HttpStatus.TOO_MANY_REQUESTS,
      'CURRENT_PASSWORD_ATTEMPTS_EXCEEDED',
      'Muitas tentativas. A sessão foi encerrada; entre de novo.',
    );
  }
}
