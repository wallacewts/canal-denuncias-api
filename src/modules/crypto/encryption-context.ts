/**
 * Campos cifrados conhecidos (R1). Lista fechada: um contexto digitado errado geraria dado impossível de abrir.
 * Inclui `attachments.object` (o arquivo no storage, que não é coluna) e `users.mfa_secret_enc` (cifrado no Vault).
 * `reporter_identities.payload_enc` fica de fora: a identidade é cifrada pelo identity-worker (D24, IDV-06).
 */
export const ENCRYPTED_FIELDS = [
  'reports.content_enc',
  'messages.body_enc',
  'internal_notes.body_enc',
  'report_status_history.justification_enc',
  'report_access_blocks.reason_enc',
  'identity_reveal_requests.justification_enc',
  'attachments.original_name_enc',
  'attachments.object',
  'users.mfa_secret_enc',
  'users.mfa_pending_secret_enc',
] as const;

export type EncryptedField = (typeof ENCRYPTED_FIELDS)[number];

/** Campos de registros com chave primária composta: quantos ids o contexto leva. */
const ID_COUNT: Partial<Record<EncryptedField, number>> = { 'report_access_blocks.reason_enc': 2 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Contexto já validado. Não é guardado: é recalculado na abertura a partir do campo e do id do registro. */
export interface EncryptionContext {
  readonly field: EncryptedField;
  readonly aad: Buffer;
}

/** Único ponto que monta a AAD `"<tabela>.<campo>:<id>[.<id2>]"`. As mensagens de erro nunca repetem os ids. */
export function encryptionContext(field: EncryptedField, ...ids: [string, ...string[]]): EncryptionContext {
  if (!(ENCRYPTED_FIELDS as readonly string[]).includes(field)) {
    throw new Error('Campo cifrado desconhecido');
  }
  if (ids.length !== (ID_COUNT[field] ?? 1)) {
    throw new Error('Quantidade de ids inválida para o campo cifrado');
  }
  if (!ids.every((id) => UUID.test(id))) {
    throw new Error('Id de registro inválido para o contexto de cifragem');
  }
  return Object.freeze({ field, aad: Buffer.from(`${field}:${ids.join('.')}`, 'utf8') });
}
