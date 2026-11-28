import { Body, HttpCode, HttpStatus, Inject, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { CurrentSession, CurrentUser, SessionService, SignInService, type SessionRecord } from '@nestjs/authentication';
import type { Request } from 'express';
import { ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-errors.decorator.js';
import { DomainError } from '../../common/http/domain-error.js';
import { toOpenApiSchema } from '../../common/http/openapi-schema.js';
import { AdminApi, OpenAdminRoute, StepRoute } from '../../common/http/route-decorators.js';
import { AUTH_CLOCK, type AuthClock } from '../../infra/auth/auth-clock.js';
import type { StaffUser } from '../../infra/auth/staff-user.js';
import { PgMfaStore } from '../../infra/auth/stores/pg-mfa.store.js';
import { AuthThrottleGuard } from '../../infra/throttle/auth-throttle.guard.js';
import {
  challengeSchema,
  confirmationResponseSchema,
  enrollmentConfirmationSchema,
  enrollmentResponseSchema,
  signInSchema,
  stepResponseSchema,
  type ChallengeInput,
  type ConfirmationResponse,
  type EnrollmentResponse,
  type SignInInput,
  type StepResponse,
} from './auth.schemas.js';
import { CredentialsService } from './credentials.service.js';
import { MfaEnrollmentService } from './mfa-enrollment.service.js';
import { nextStepFor } from './next-step.js';
import { sessionExpiry } from './session-expiry.js';
import { StaffCredentialsRepository } from './staff-credentials.repository.js';

/** Janela e limite do bloqueio do desafio: os mesmos da configuração do pacote (auth-infra.module). */
const MFA_LOCKOUT_WINDOW_MS = 15 * 60_000;
const MFA_MAX_ATTEMPTS = 5;
const GENERIC_FAILURE = 'Credenciais inválidas.';

/**
 * Entrada da equipe (feature 006; promovida do login de exemplo da feature 004): senha, desafio do segundo fator e
 * saída. Rotas abertas antes da sessão completa (`OpenAdminRoute`); o resto da área administrativa exige sessão
 * verificada. 401 só para sessão ausente ou expirada; na entrada, é a falha genérica de credencial.
 */
@AdminApi('auth')
export class AuthController {
  constructor(
    private readonly creds: CredentialsService,
    private readonly credentials: StaffCredentialsRepository,
    private readonly signInService: SignInService,
    private readonly sessions: SessionService,
    private readonly mfaStore: PgMfaStore,
    private readonly enrollment: MfaEnrollmentService,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
  ) {}

  @OpenAdminRoute()
  @UseGuards(AuthThrottleGuard)
  @ApiOkResponse({
    description: 'Próxima etapa e horários; cookie de sessão.',
    schema: toOpenApiSchema(stepResponseSchema),
  })
  @ApiErrors({
    400: 'corpo inválido',
    401: 'falha genérica de credencial (qualquer motivo)',
    403: 'escrita de outra origem (proteção por origem)',
    429: ['TOO_MANY_ATTEMPTS'],
  })
  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Body({ schema: signInSchema }) body: SignInInput, @Req() req: Request): Promise<StepResponse> {
    const result = await this.creds.verify(body.email, body.password);
    if (!result.ok) throw new UnauthorizedException(GENERIC_FAILURE);
    const { session } = await this.signInService.signIn(result.userId, {
      method: 'password',
      metadata: { ip: req.ip ?? null, userAgent: req.get('user-agent')?.slice(0, 255) ?? null },
    });
    return this.step(session, result.userId);
  }

  @OpenAdminRoute()
  @UseGuards(AuthThrottleGuard)
  @ApiOkResponse({ description: 'Próxima etapa e horários; cookie novo.', schema: toOpenApiSchema(stepResponseSchema) })
  @ApiErrors({
    400: 'corpo inválido',
    401: 'sessão pendente ausente ou expirada',
    403: 'escrita de outra origem (proteção por origem)',
    422: ['MFA_CODE_INVALID'],
    423: ['MFA_LOCKED'],
    429: ['TOO_MANY_ATTEMPTS'],
  })
  @Post('mfa/challenge')
  @HttpCode(200)
  async challenge(@Body({ schema: challengeSchema }) body: ChallengeInput, @Req() req: Request): Promise<StepResponse> {
    const current = await this.sessions.validate(this.sessions.tokenFrom(req));
    if (current?.mfa !== 'pending') throw new UnauthorizedException();
    const userId = current.userId;
    const now = this.clock.now();
    if (
      (await this.credentials.isLocked(userId, new Date(now))) ||
      (await this.mfaStore.countMfaFailures(userId, MFA_LOCKOUT_WINDOW_MS, now)) >= MFA_MAX_ATTEMPTS
    ) {
      throw new DomainError(HttpStatus.LOCKED, 'MFA_LOCKED', 'Muitas tentativas. Tente de novo mais tarde.');
    }
    const issued = await this.signInService.completeMfa(
      'code' in body ? { code: body.code } : { recoveryCode: body.recoveryCode },
    );
    if (!issued) {
      // Sessão que sumiu no meio (revogada ou expirada) é 401; código recusado é 422 (Q1).
      if (!(await this.sessions.validate(this.sessions.tokenFrom(req)))) throw new UnauthorizedException();
      await this.creds.registerMfaFailure(userId);
      throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'MFA_CODE_INVALID', 'Código inválido.');
    }
    await this.credentials.resetFailures(userId);
    return this.step(issued.session, userId);
  }

  @StepRoute('MFA_ENROLLMENT_REQUIRED')
  @ApiOkResponse({
    description: 'URI, QR code PNG e segredo (só nesta resposta).',
    schema: toOpenApiSchema(enrollmentResponseSchema),
  })
  @ApiErrors({ 401: 'sessão ausente ou expirada', 403: ['STEP_NOT_ALLOWED'] })
  @Post('mfa/enrollment')
  @HttpCode(200)
  enroll(@CurrentUser() user: StaffUser): Promise<EnrollmentResponse> {
    return this.enrollment.enroll(user.id);
  }

  @StepRoute('MFA_ENROLLMENT_REQUIRED')
  @ApiOkResponse({
    description: '10 códigos de recuperação (uma única vez), próxima etapa e horários; cookie novo.',
    schema: toOpenApiSchema(confirmationResponseSchema),
  })
  @ApiErrors({
    400: 'corpo inválido',
    401: 'sessão ausente ou expirada',
    403: ['STEP_NOT_ALLOWED'],
    422: ['MFA_CODE_INVALID'],
  })
  @Post('mfa/enrollment/confirmation')
  @HttpCode(200)
  confirmEnrollment(
    @CurrentUser() user: StaffUser,
    @CurrentSession() session: SessionRecord,
    @Body({ schema: enrollmentConfirmationSchema }) body: { code: string },
  ): Promise<ConfirmationResponse> {
    return this.enrollment.confirm(user.id, session, body.code);
  }

  @OpenAdminRoute()
  @ApiNoContentResponse({ description: 'Sessão encerrada; cookie apagado.' })
  @ApiErrors({ 403: 'escrita de outra origem (proteção por origem)' })
  @Post('sign-out')
  @HttpCode(204)
  async signOut(): Promise<void> {
    await this.signInService.signOut();
  }

  private async step(session: { mfa?: 'pending' | 'verified'; lastActiveAt: Date; expiresAt: Date }, userId: string) {
    const passwordChangeRequired = await this.credentials.passwordChangeRequired(userId);
    return {
      nextStep: nextStepFor({ mfa: session.mfa, passwordChangeRequired }),
      ...sessionExpiry(session, this.clock.now()),
    };
  }
}
