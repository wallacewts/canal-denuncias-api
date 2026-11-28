import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type { Page } from './page.schema.js';

const BIGINT_MAX = 9223372036854775807n;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,28}$/;
const CANONICAL_ID = /^[1-9]\d{0,18}$/;

/** Cursor opaco para ids bigint: o número em decimal, em base64url. */
export function encodeBigintCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

/** Id do cursor, ou `null` se o cursor estiver malformado, adulterado ou fora da faixa do bigint. */
export function decodeBigintCursor(cursor: string): string | null {
  if (!CURSOR_PATTERN.test(cursor)) return null;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  // Só a forma canônica: evita dois cursores para o mesmo id.
  if (!CANONICAL_ID.test(decoded) || encodeBigintCursor(decoded) !== cursor) return null;
  return BigInt(decoded) <= BIGINT_MAX ? decoded : null;
}

/**
 * Paginação por cursor em ordem decrescente de id bigint (trilha de auditoria): `WHERE id < :after ORDER BY id DESC
 * LIMIT :limit + 1`. Sem OFFSET e sem COUNT.
 */
export async function paginateDesc<T extends ObjectLiteral & { id: string }>(
  queryBuilder: SelectQueryBuilder<T>,
  { limit, after }: { limit: number; after?: string | undefined },
): Promise<Page<T>> {
  const alias = queryBuilder.alias;
  if (after) queryBuilder.andWhere(`${alias}.id < :pageBefore`, { pageBefore: after });
  const rows = await queryBuilder
    .orderBy(`${alias}.id`, 'DESC')
    .limit(limit + 1)
    .getMany();
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeBigintCursor(items.at(-1)!.id) : null };
}
