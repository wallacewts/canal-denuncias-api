import { z } from 'zod';

/** Limite padrão de texto livre quando o recurso não define um próprio (FR-007). */
export const DEFAULT_TEXT_MAX = 2000;

/**
 * Texto livre sempre com limite de tamanho. Todo campo de texto de entrada usa este helper, nunca `z.string()` puro.
 */
export function text(options: { max?: number; min?: number } = {}) {
  const { max = DEFAULT_TEXT_MAX, min = 0 } = options;
  return z.string().min(min).max(max);
}

/** Identificador UUID (os IDs do sistema são UUID v7). */
export function uuid() {
  return z.uuid();
}

/**
 * Objeto que recusa campos desconhecidos com 400 (FR-006), em vez de descartá-los em silêncio.
 * Todo schema de entrada (corpo, query, parâmetros) parte daqui.
 */
export const strictObject = z.strictObject;
