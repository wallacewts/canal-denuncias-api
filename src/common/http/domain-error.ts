import { HttpException } from '@nestjs/common';

/** Código estável de erro (D56): maiúsculas, dígitos e sublinhado. */
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** `details` só com inteiros não negativos e enums em maiúsculas: nunca texto livre nem valor recebido. */
export type ErrorDetails = Readonly<Record<string, number | string>>;

function assertDetails(details: ErrorDetails): void {
  for (const value of Object.values(details)) {
    const ok = typeof value === 'number' ? Number.isSafeInteger(value) && value >= 0 : CODE.test(value);
    if (!ok) throw new TypeError('details aceita só inteiros não negativos e códigos em maiúsculas');
  }
}

/**
 * Erro de regra de negócio com código estável e detalhes seguros (D56). A mensagem é fixa, escrita no código, e nunca
 * leva valor recebido.
 */
export class DomainError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    if (!CODE.test(code)) throw new TypeError('code fora do formato');
    if (details) assertDetails(details);
    super(message, status);
    this.name = 'DomainError';
  }
}

export class DomainConflictError extends DomainError {
  constructor(code: string, message: string, details?: ErrorDetails) {
    super(409, code, message, details);
    this.name = 'DomainConflictError';
  }
}
