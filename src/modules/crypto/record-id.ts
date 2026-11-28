import { randomUUIDv7 } from 'node:crypto';

/**
 * Id de registro gerado na aplicação, antes da cifragem, porque a AAD precisa dele (FR-014, D44). Mesmo formato do
 * `uuidv7()` do Postgres 18, que continua como default de reserva no banco.
 */
export function newRecordId(): string {
  return randomUUIDv7();
}
