import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { MfaService, SignInService, type SessionRecord } from '@nestjs/authentication';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { DomainError } from '../../common/http/domain-error.js';
import { AUTH_CLOCK, type AuthClock } from '../../infra/auth/auth-clock.js';
import { SESSION_ABSOLUTE_TTL_MS } from '../../infra/auth/session-policy.js';
import { AuditAction, AuditResourceType } from '../audit/audit-action.enum.js';
import { AuditService } from '../audit/audit.service.js';
import type { ConfirmationResponse, EnrollmentResponse } from './auth.schemas.js';
import { NextStep } from './next-step.js';
import { qrPngDataUri } from './qr-png.js';
import { sessionExpiry } from './session-expiry.js';
import { StaffCredentialsRepository } from './staff-credentials.repository.js';

/**
 * Cadastro do autenticador no primeiro acesso (AUTH-03, feature 006, R8). O segredo é selado pelo `PgMfaStore`
 * (Vault) e só sai nesta resposta; o QR code é montado no servidor. A confirmação ativa o autenticador, troca o id
 * da sessão (verificada) e devolve os 10 códigos de recuperação uma única vez: é o fim do primeiro acesso.
 */
@Injectable()
export class MfaEnrollmentService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly mfa: MfaService,
    private readonly signIn: SignInService,
    private readonly credentials: StaffCredentialsRepository,
    private readonly audit: AuditService,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
  ) {}

  async enroll(userId: string): Promise<EnrollmentResponse> {
    const [row] = (await this.ds.query(`SELECT email FROM users WHERE id = $1`, [userId])) as Array<{ email: string }>;
    const { secret, uri } = await this.mfa.enroll(userId, row.email);
    return { otpauthUri: uri, qrCodeDataUri: qrPngDataUri(uri), secret };
  }

  async confirm(userId: string, session: SessionRecord, code: string): Promise<ConfirmationResponse> {
    if (!(await this.signIn.confirmMfa(userId, code))) {
      throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'MFA_CODE_INVALID', 'Código inválido.');
    }
    const recoveryCodes = await this.mfa.generateRecoveryCodes(userId);
    const now = this.clock.now();
    await this.credentials.resetFailures(userId);
    await this.ds.query(`UPDATE users SET last_login_at = $2 WHERE id = $1`, [userId, new Date(now)]);
    // Fim do primeiro acesso: a sessão ficou verificada aqui (o desafio não aconteceu), então o login é registrado aqui.
    await this.audit.record({
      action: AuditAction.AUTH_SIGNED_IN,
      resourceType: AuditResourceType.SESSION,
      resourceId: null,
      result: AuditResult.SUCCESS,
      metadata: { method: 'password' },
    });
    // A rotação para "verificada" manteve a criação e fixou o fim absoluto em criação + 8 h; o último uso é agora.
    const expiry = sessionExpiry(
      { lastActiveAt: new Date(now), expiresAt: new Date(session.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS) },
      now,
    );
    return { recoveryCodes, nextStep: NextStep.DONE, ...expiry };
  }
}
