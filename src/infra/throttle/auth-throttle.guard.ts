import { type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { DomainError } from '../../common/http/domain-error.js';

/**
 * Limite de tentativas das rotas de entrada (feature 006, R4). Mesma lógica do `ThrottlerGuard`, com o cabeçalho
 * `Retry-After` (em segundos) e o erro no formato da API (D56). A mensagem é a mesma para qualquer conta, existente
 * ou não.
 */
@Injectable()
export class AuthThrottleGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
    res.setHeader('Retry-After', String(detail.timeToBlockExpire));
    throw new DomainError(
      HttpStatus.TOO_MANY_REQUESTS,
      'TOO_MANY_ATTEMPTS',
      'Muitas tentativas. Tente de novo mais tarde.',
    );
  }
}
