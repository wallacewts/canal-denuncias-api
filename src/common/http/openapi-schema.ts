import type { ApiResponseSchemaHost } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * JSON Schema de um schema zod para o OpenAPI, sem a chave `$schema` (o documento não a aceita dentro de uma
 * operação). As respostas documentadas saem do mesmo schema que os testes usam para validar a resposta real.
 */
export function toOpenApiSchema(schema: z.ZodType): ApiResponseSchemaHost['schema'] {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: 'output' }) as Record<string, unknown>;
  return json as ApiResponseSchemaHost['schema'];
}
