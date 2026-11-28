import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../common/http/domain-error.js';
import {
  ADMIN_OPEN_METADATA,
  ALLOW_DURING_PASSWORD_CHANGE_METADATA,
  API_AREA_METADATA,
  STEP_ROUTE_METADATA,
  type ApiArea,
  type LoginStep,
} from '../../common/http/route-decorators.js';
import { nextStepFor } from '../../modules/auth/next-step.js';
import type { StaffUser } from './staff-user.js';

/**
 * Etapas do login na área administrativa (feature 006, R2, R11, I1), depois do guard de identidade:
 * - rota de etapa (`StepRoute`) fora da etapa atual → 403 `STEP_NOT_ALLOWED`;
 * - sessão verificada com troca obrigatória pendente → 403 `PASSWORD_CHANGE_REQUIRED`, exceto as rotas marcadas com
 *   `AllowDuringPasswordChange` (o `GET /me`) e as de etapa que aceitam a troca.
 * A sessão sem segundo fator verificado já é recusada pelo pacote (401) fora das rotas de etapa.
 */
@Injectable()
export class LoginStepGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const area = this.reflector.get<ApiArea | undefined>(API_AREA_METADATA, context.getClass());
    if (area !== 'admin') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(ADMIN_OPEN_METADATA, targets)) return true;

    const user = context.switchToHttp().getRequest<{ user?: StaffUser }>().user;
    if (!user) return true; // sem identidade, o guard anterior já respondeu 401
    const step = currentStep(user);
    const steps = this.reflector.get<LoginStep[] | undefined>(STEP_ROUTE_METADATA, context.getHandler());
    if (steps) {
      if (!steps.includes(step)) {
        throw new DomainError(HttpStatus.FORBIDDEN, 'STEP_NOT_ALLOWED', 'Esta etapa não está disponível agora.');
      }
      return true;
    }
    if (
      step === 'PASSWORD_CHANGE_REQUIRED' &&
      !this.reflector.get(ALLOW_DURING_PASSWORD_CHANGE_METADATA, context.getHandler())
    ) {
      throw new DomainError(HttpStatus.FORBIDDEN, 'PASSWORD_CHANGE_REQUIRED', 'Troque a senha para continuar.');
    }
    return true;
  }
}

/** A sessão que chega aqui nunca está pendente (o pacote recusa antes): verificada ou sem segundo fator. */
function currentStep(user: StaffUser): LoginStep {
  return nextStepFor({
    mfa: user.mfaVerified ? 'verified' : null,
    passwordChangeRequired: Boolean(user.passwordChangeRequired),
  });
}
