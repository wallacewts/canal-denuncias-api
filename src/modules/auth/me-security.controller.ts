import { Body, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { CurrentSession, CurrentUser, type SessionRecord } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { z } from 'zod';
import { AdminApi, StepRoute } from '../../common/http/route-decorators.js';
import type { StaffUser } from '../../infra/auth/staff-user.js';
import { passwordChangeSchema, type OwnSession, type PasswordChangeInput, type StepResponse } from './auth.schemas.js';
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
  @Get('sessions')
  listSessions(@CurrentUser() user: StaffUser, @CurrentSession() session: SessionRecord): Promise<OwnSession[]> {
    return this.ownSessions.list(user.id, session.id);
  }

  @Can.Anyone()
  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(
    @CurrentUser() user: StaffUser,
    @Param('id', { schema: sessionIdParam }) id: string,
  ): Promise<void> {
    await this.ownSessions.revoke(user.id, id);
  }

  @Can.Anyone()
  @Delete('sessions')
  @HttpCode(204)
  async revokeAll(@CurrentUser() user: StaffUser): Promise<void> {
    await this.ownSessions.revokeAll(user.id);
  }
}
