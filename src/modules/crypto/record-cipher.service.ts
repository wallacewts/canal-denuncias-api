import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { ContentSchemaError } from './crypto.errors.js';
import type { EncryptionContext } from './encryption-context.js';
import { openField, sealField } from './field-cipher.js';

/** Mapa de schemas por versão do conteúdo (ex.: `{ 1: ReportContentV1Schema }`). */
export type VersionedSchemas = Record<number, z.ZodType>;

/**
 * Selar e abrir registros (CRYPTO-03, R5). Objetos sempre têm o campo `v`; na abertura, o objeto é validado contra o
 * schema da sua versão e nada parcial é devolvido. Usado por reports, messages, case-management e identity-vault.
 */
@Injectable()
export class RecordCipher {
  sealJson(dek: Buffer, ctx: EncryptionContext, value: { v: number; [field: string]: unknown }): Buffer {
    return sealField(Buffer.from(JSON.stringify(value), 'utf8'), dek, ctx);
  }

  openJson<S extends VersionedSchemas>(
    dek: Buffer,
    ctx: EncryptionContext,
    sealed: Buffer,
    schemas: S,
  ): z.infer<S[keyof S]> {
    const plaintext = openField(sealed, dek, ctx);
    let value: unknown;
    try {
      value = JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw new ContentSchemaError();
    } finally {
      plaintext.fill(0);
    }
    const version = (value as { v?: unknown } | null)?.v;
    const schema = typeof version === 'number' ? schemas[version] : undefined;
    if (!schema) throw new ContentSchemaError();
    const parsed = schema.safeParse(value);
    // As issues do zod não saem daqui: podem citar trechos do conteúdo.
    if (!parsed.success) throw new ContentSchemaError();
    return parsed.data as z.infer<S[keyof S]>;
  }

  sealText(dek: Buffer, ctx: EncryptionContext, text: string): Buffer {
    return sealField(Buffer.from(text, 'utf8'), dek, ctx);
  }

  openText(dek: Buffer, ctx: EncryptionContext, sealed: Buffer): string {
    const plaintext = openField(sealed, dek, ctx);
    try {
      return plaintext.toString('utf8');
    } finally {
      plaintext.fill(0);
    }
  }
}
