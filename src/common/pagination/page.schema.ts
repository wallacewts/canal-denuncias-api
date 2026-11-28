import { z } from 'zod';
import { strictObject } from '../validation/schemas.js';
import { decodeCursor } from './cursor.js';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Campos de paginação (`?limit=&after=`). Listagens com filtros próprios espalham este objeto no próprio schema:
 * `strictObject({ ...pageQueryShape, status: ... })`.
 */
export const pageQueryShape = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  after: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      const id = decodeCursor(value);
      if (!id) {
        ctx.addIssue({ code: 'custom', message: 'Cursor inválido' });
        return z.NEVER;
      }
      return id;
    }),
};

export const pageQuerySchema = strictObject(pageQueryShape);
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** Resposta paginada (contracts/page.schema.json). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
