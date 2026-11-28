import type { ApiResponseSchemaHost } from '@nestjs/swagger';
import { z } from 'zod';
import { Role } from '../../common/enums/role.enum.js';
import { ABILITY_CATALOG, type Ability } from '../access-control/abilities.js';

const abilities = Object.keys(ABILITY_CATALOG) as [Ability, ...Ability[]];

/**
 * Resposta do `GET /me` (USERS-07, contracts/me-api.md): o mesmo formato do `CurrentUser` do front, que recusa
 * chave a mais ou a menos. Fonte do tipo e do schema publicado no `openapi/admin.json`.
 */
export const currentUserResponseSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().max(120),
  email: z.string().max(254),
  roles: z.array(z.enum(Role)).max(5),
  mfaEnabledAt: z.iso.datetime().nullable(),
  passwordChangeRequired: z.boolean(),
  abilities: z.array(z.enum(abilities)).max(abilities.length),
  idleExpiresAt: z.iso.datetime(),
  absoluteExpiresAt: z.iso.datetime(),
});

export type CurrentUserView = z.infer<typeof currentUserResponseSchema>;

/** JSON Schema da resposta, sem a chave `$schema` (o documento OpenAPI não a aceita dentro de uma operação). */
export function currentUserOpenApiSchema(): ApiResponseSchemaHost['schema'] {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(currentUserResponseSchema) as Record<string, unknown>;
  return schema as ApiResponseSchemaHost['schema'];
}
