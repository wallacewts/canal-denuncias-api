import type { Queue, JobsOptions } from 'bullmq';
import { z } from 'zod';

type FieldDef = { type: string; format?: string; innerType?: z.ZodType };

/** Tipos aceitos num payload de job: só identificadores e códigos. Nunca texto livre (FR-018). */
function isAllowedField(schema: z.ZodType): boolean {
  const def = (schema as unknown as { _zod: { def: FieldDef } })._zod.def;
  if (def.type === 'optional' && def.innerType) return isAllowedField(def.innerType);
  return (def.type === 'string' && def.format === 'uuid') || def.type === 'enum' || def.type === 'number';
}

/**
 * Schema do payload de um job. Só aceita campos UUID, enum ou número e recusa campos extras: o Redis não é
 * cifrado, então conteúdo de denúncia nunca pode ir para a fila. Declarar um campo de outro tipo falha na hora,
 * antes de qualquer job ser enfileirado.
 */
export function jobPayloadSchema<T extends Record<string, z.ZodType>>(shape: T) {
  for (const [name, field] of Object.entries(shape)) {
    if (!isAllowedField(field)) {
      throw new Error(
        `Campo '${name}' não permitido em payload de job: use só UUID, enum ou número (nada de texto livre)`,
      );
    }
  }
  return z.strictObject(shape);
}

/** Enfileira só depois de validar o payload. O erro de validação nunca repete o valor recebido. */
export async function addValidatedJob<S extends z.ZodType>(
  queue: Pick<Queue, 'add'>,
  name: string,
  schema: S,
  data: z.input<S>,
  options?: JobsOptions,
) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(payload)'))].join(', ');
    throw new Error(`Payload inválido para o job '${name}' (campos: ${fields})`);
  }
  return queue.add(name, result.data, options);
}
