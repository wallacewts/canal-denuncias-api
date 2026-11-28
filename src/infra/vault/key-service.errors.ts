import { InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';

export type KeyServiceUnavailableReason = 'timeout' | 'unreachable' | 'sealed' | 'server-error';

/**
 * Vault fora do ar, selado ou sem resposta no prazo. Vira 503 para o cliente da API (FR-014).
 * A mensagem é fixa e o erro não carrega a causa original nem nada que tenha ido ou voltado do Vault (FR-015).
 */
export class KeyServiceUnavailableError extends ServiceUnavailableException {
  constructor(readonly reason: KeyServiceUnavailableReason) {
    super('Serviço de chaves indisponível');
    this.name = 'KeyServiceUnavailableError';
  }
}

/**
 * O Vault recusou a operação (ciphertext inválido, permissão negada...). É erro de programação ou de dado, não de
 * disponibilidade: vira 500 genérico. Só o código HTTP do Vault é guardado, nunca o corpo da resposta.
 */
export class KeyServiceRequestError extends InternalServerErrorException {
  constructor(readonly vaultStatus: number) {
    super('Operação recusada pelo serviço de chaves');
    this.name = 'KeyServiceRequestError';
  }
}
