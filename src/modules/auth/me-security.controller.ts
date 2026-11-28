import { Body, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { CurrentSession, CurrentUser, type SessionRecord } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { z } from 'zod';
import { ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-errors.decorator.js';
import { toOpenApiSchema } from '../../common/http/openapi-schema.js';
import { AdminApi, StepRoute } from '../../common/http/route-decorators.js';
import type { StaffUser } from '../../infra/auth/staff-user.js';
import {
  ownSessionSchema,
  passwordChangeSchema,
  stepResponseSchema,
  type OwnSession,
  type PasswordChangeInput,
  type StepResponse,
} from './auth.schemas.js';
import { OwnSessionsService } from './own-sessions.service.js';
import { PasswordChangeService } from './password-change.service.js';

/** Id público de sessão: 32 caracteres hexadecimais (R13). */
const sessionIdParam = z.string().regex(/^[0-9a-f]{32}$/);

/** Segurança da própria conta (feature 006): troca de senha e sessões próprias. */
@AdminApi('me')
export class MeSecurityController {
  constructor(
    private readonly passwords: PasswordChangeService,
    private readonly ownSessions: OwnSessionsService,
  ) {}

  @StepRoute('PASSWORD_CHANGE_REQUIRED', 'DONE')
  @ApiOkResponse({ description: 'Próxima etapa e horários; cookie novo.', schema: toOpenApiSchema(stepResponseSchema) })
  @ApiErrors({
    400: 'corpo inválido',
    401: 'sessão ausente ou expirada',
    403: ['STEP_NOT_ALLOWED'],
    422: [
      'CURRENT_PASSWORD_INVALID',
      'PASSWORD_TOO_SHORT',
      'PASSWORD_TOO_LONG',
      'PASSWORD_COMMON',
      'PASSWORD_SAME_AS_CURRENT',
    ],
    429: ['CURRENT_PASSWORD_ATTEMPTS_EXCEEDED'],
  })
  @Put('password')
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: StaffUser,
    @CurrentSession() session: SessionRecord,
    @Body({ schema: passwordChangeSchema }) body: PasswordChangeInput,
  ): Promise<StepResponse> {
    return this.passwords.change(user.id, session, body);
  }

  @Can.Anyone()
  @ApiOkResponse({
    description: 'Sessões vivas da própria pessoa.',
    schema: toOpenApiSchema(z.array(ownSessionSchema)),
  })
  @ApiErrors({ 401: 'sessão ausente ou expirada', 403: ['PASSWORD_CHANGE_REQUIRED'] })
  @Get('sessions')
  listSessions(@CurrentUser() user: StaffUser, @CurrentSession() session: SessionRecord): Promise<OwnSession[]> {
    return this.ownSessions.list(user.id, session.id);
  }

  @Can.Anyone()
  @ApiErrors({
    400: 'id inválido',
    401: 'sessão ausente ou expirada',
    403: ['PASSWORD_CHANGE_REQUIRED'],
    404: 'sessão não encontrada',
  })
  @ApiNoContentResponse({ description: 'Sessão encerrada.' })
  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(
    @CurrentUser() user: StaffUser,
    @Param('id', { schema: sessionIdParam }) id: string,
  ): Promise<void> {
    await this.ownSessions.revoke(user.id, id);
  }

  @Can.Anyone()
  @ApiErrors({ 401: 'sessão ausente ou expirada', 403: ['PASSWORD_CHANGE_REQUIRED'] })
  @ApiNoContentResponse({ description: 'Todas as sessões encerradas; cookie apagado.' })
  @Delete('sessions')
  @HttpCode(204)
  async revokeAll(@CurrentUser() user: StaffUser): Promise<void> {
    await this.ownSessions.revokeAll(user.id);
  }
}
