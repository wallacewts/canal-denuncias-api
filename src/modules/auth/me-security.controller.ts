import { Body, HttpCode, Put } from '@nestjs/common';
import { CurrentSession, CurrentUser, type SessionRecord } from '@nestjs/authentication';
import { AdminApi, StepRoute } from '../../common/http/route-decorators.js';
import type { StaffUser } from '../../infra/auth/staff-user.js';
import { passwordChangeSchema, type PasswordChangeInput, type StepResponse } from './auth.schemas.js';
import { PasswordChangeService } from './password-change.service.js';

/** Segurança da própria conta (feature 006): troca de senha; sessões próprias entram na US4. */
@AdminApi('me')
export class MeSecurityController {
  constructor(private readonly passwords: PasswordChangeService) {}

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
}
