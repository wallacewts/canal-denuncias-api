import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DecryptionFailedError, UnsupportedFormatError } from './crypto.errors.js';
import type { EncryptionContext } from './encryption-context.js';

/**
 * Formato v1 do campo cifrado (constituição, princípio III; contracts/field-format.md):
 * `[1 byte versão][12 bytes nonce][ciphertext][16 bytes tag]`, AES-256-GCM, AAD = contexto do registro.
 */
const VERSION = 0x01;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const MIN_LENGTH = 1 + NONCE_BYTES + TAG_BYTES;

export function sealField(plaintext: Buffer, dek: Buffer, ctx: EncryptionContext): Buffer {
  assertKey(dek);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dek, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(ctx.aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), nonce, ciphertext, cipher.getAuthTag()]);
}

export function openField(sealed: Buffer, dek: Buffer, ctx: EncryptionContext): Buffer {
  assertKey(dek);
  if (sealed.length < MIN_LENGTH || sealed[0] !== VERSION) throw new UnsupportedFormatError();
  const nonce = sealed.subarray(1, 1 + NONCE_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const ciphertext = sealed.subarray(1 + NONCE_BYTES, sealed.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', dek, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(ctx.aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // O erro do OpenSSL nunca é repassado: só o tipo próprio, sem causa (R9).
    throw new DecryptionFailedError();
  }
}

function assertKey(dek: Buffer): void {
  if (dek.length !== KEY_BYTES) throw new Error('Chave de dados com tamanho inválido');
}
