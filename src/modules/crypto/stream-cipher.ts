import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { DecryptionFailedError, UnsupportedFormatError } from './crypto.errors.js';
import type { EncryptionContext } from './encryption-context.js';

/**
 * Arquivos cifrados em streaming, formato STREAM v1 (CRYPTO-04, D40, contracts/stream-format.md):
 * cabeçalho `[versão 1][tamanho do bloco 4 BE][prefixo de nonce 8]` e blocos de 64 KiB em AES-256-GCM.
 * Nonce do bloco `i` = prefixo + `i` (uint32 BE). AAD = contexto + marcação de último bloco; o cabeçalho entra na AAD
 * do bloco 0. O texto em claro de um bloco só sai depois de a tag dele ser verificada.
 */
const VERSION = 0x01;
const CHUNK = 64 * 1024;
const PREFIX_BYTES = 8;
const HEADER_BYTES = 1 + 4 + PREFIX_BYTES;
const TAG_BYTES = 16;
const MAX_BLOCKS = 0xffff_ffff;

export interface EncryptStream {
  stream: Transform;
  /** sha256 (hex) dos bytes cifrados emitidos, cabeçalho incluído. Disponível depois do fim do stream. */
  ciphertextSha256(): string;
}

export function createEncryptStream(dek: Buffer, ctx: EncryptionContext): EncryptStream {
  const key = copyKey(dek);
  const prefix = randomBytes(PREFIX_BYTES);
  const header = Buffer.alloc(HEADER_BYTES);
  header[0] = VERSION;
  header.writeUInt32BE(CHUNK, 1);
  prefix.copy(header, 5);
  const hash = createHash('sha256');
  let pending = Buffer.alloc(0);
  let index = 0;
  let digest: string | undefined;

  const emit = (stream: Transform, data: Buffer) => {
    hash.update(data);
    stream.push(data);
  };
  const sealBlock = (stream: Transform, plain: Buffer, last: boolean) => {
    if (index === 0) emit(stream, header);
    const cipher = createCipheriv('aes-256-gcm', key, nonce(prefix, index), { authTagLength: TAG_BYTES });
    cipher.setAAD(blockAad(ctx, index === 0 ? header : undefined, last));
    emit(stream, Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]));
    index++;
  };

  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      try {
        pending = Buffer.concat([pending, chunk]);
        // Segura sempre um bloco: só no fim se sabe qual é o último.
        while (pending.length > CHUNK) {
          if (index >= MAX_BLOCKS) throw new Error('Arquivo grande demais para o formato');
          sealBlock(this, pending.subarray(0, CHUNK), false);
          pending = pending.subarray(CHUNK);
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        sealBlock(this, pending, true);
        digest = hash.digest('hex');
        callback();
      } catch (error) {
        callback(error as Error);
      } finally {
        key.fill(0);
      }
    },
    destroy(error, callback) {
      key.fill(0);
      callback(error);
    },
  });

  return {
    stream,
    ciphertextSha256() {
      if (!digest) throw new Error('O stream ainda não terminou');
      return digest;
    },
  };
}

export function createDecryptStream(dek: Buffer, ctx: EncryptionContext): Transform {
  const key = copyKey(dek);
  const sealedBlock = CHUNK + TAG_BYTES;
  let header: Buffer | undefined;
  let prefix: Buffer | undefined;
  let pending = Buffer.alloc(0);
  let index = 0;

  const openBlock = (stream: Transform, sealed: Buffer, last: boolean) => {
    if (sealed.length < TAG_BYTES) throw new DecryptionFailedError();
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce(prefix!, index), { authTagLength: TAG_BYTES });
      decipher.setAAD(blockAad(ctx, index === 0 ? header : undefined, last));
      decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
      const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
      index++;
      if (plain.length) stream.push(plain);
    } catch {
      throw new DecryptionFailedError();
    }
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      try {
        pending = Buffer.concat([pending, chunk]);
        if (!header) {
          if (pending.length < HEADER_BYTES) return callback();
          header = Buffer.from(pending.subarray(0, HEADER_BYTES));
          if (header[0] !== VERSION || header.readUInt32BE(1) !== CHUNK) throw new UnsupportedFormatError();
          prefix = header.subarray(5);
          pending = pending.subarray(HEADER_BYTES);
        }
        // Segura sempre um bloco: o último é aberto com a marcação de último no flush.
        while (pending.length > sealedBlock) {
          openBlock(this, pending.subarray(0, sealedBlock), false);
          pending = pending.subarray(sealedBlock);
        }
        callback();
      } catch (error) {
        callback(toCryptoError(error));
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (!header) throw new UnsupportedFormatError();
        openBlock(this, pending, true);
        callback();
      } catch (error) {
        callback(toCryptoError(error));
      } finally {
        key.fill(0);
      }
    },
    destroy(error, callback) {
      key.fill(0);
      callback(error);
    },
  });
}

function copyKey(dek: Buffer): Buffer {
  if (dek.length !== 32) throw new Error('Chave de dados com tamanho inválido');
  // Cópia própria: o chamador pode zerar a DEK dele assim que o stream for criado.
  const key = Buffer.alloc(32);
  dek.copy(key);
  return key;
}

function nonce(prefix: Buffer, index: number): Buffer {
  const n = Buffer.alloc(PREFIX_BYTES + 4);
  prefix.copy(n, 0);
  n.writeUInt32BE(index, PREFIX_BYTES);
  return n;
}

function blockAad(ctx: EncryptionContext, header: Buffer | undefined, last: boolean): Buffer {
  const flag = Buffer.from([last ? 0x01 : 0x00]);
  return header ? Buffer.concat([header, ctx.aad, flag]) : Buffer.concat([ctx.aad, flag]);
}

function toCryptoError(error: unknown): Error {
  return error instanceof UnsupportedFormatError ? error : new DecryptionFailedError();
}
