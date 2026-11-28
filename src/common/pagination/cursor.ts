import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type { Page, PageQuery } from './page.schema.js';

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Cursor opaco: os 16 bytes do UUID v7 em base64url (22 caracteres). */
export function encodeCursor(id: string): string {
  return Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url');
}

/** UUID do cursor, ou `null` se o cursor estiver malformado ou adulterado. */
export function decodeCursor(cursor: string): string | null {
  if (!CURSOR_PATTERN.test(cursor)) return null;
  const bytes = Buffer.from(cursor, 'base64url');
  // Só a forma canônica é aceita: evita dois cursores diferentes para o mesmo id.
  if (bytes.length !== 16 || bytes.toString('base64url') !== cursor) return null;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Paginação por cursor (TRV-08): `WHERE id > :after ORDER BY id LIMIT :limit + 1`. Sem OFFSET e sem COUNT, estável
 * com inserções concorrentes porque os ids são UUID v7 (ordenados pelo tempo de criação).
 */
export async function paginate<T extends ObjectLiteral & { id: string }>(
  queryBuilder: SelectQueryBuilder<T>,
  { limit, after }: PageQuery,
): Promise<Page<T>> {
  const alias = queryBuilder.alias;
  if (after) queryBuilder.andWhere(`${alias}.id > :pageAfter`, { pageAfter: after });

  const rows = await queryBuilder
    .orderBy(`${alias}.id`, 'ASC')
    .limit(limit + 1)
    .getMany();
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeCursor(items.at(-1)!.id) : null };
}
