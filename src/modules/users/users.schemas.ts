import { z } from 'zod';
import { Role } from '../../common/enums/role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import { pageQueryShape } from '../../common/pagination/page.schema.js';
import { strictObject, text, uuid } from '../../common/validation/schemas.js';

/** Entrada das rotas de equipe (contracts/users-api.md). Mensagens fixas, sem valor recebido. */

const name = text({ max: 120 }).trim().min(1);
const email = text({ max: 254 }).trim().pipe(z.email());
const roles = z
  .array(z.enum(Role))
  .min(1)
  .max(5)
  .refine((list) => new Set(list).size === list.length, { message: 'Perfis repetidos' });

export const userIdParam = uuid();

export const createUserSchema = strictObject({ name, email, roles });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateNameSchema = strictObject({ name });
export const updateStatusSchema = strictObject({ status: z.enum(UserStatus) });
export const updateRolesSchema = strictObject({ roles });

export const listUsersQuerySchema = strictObject({
  ...pageQueryShape,
  status: z.enum(UserStatus).optional(),
  role: z.enum(Role).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
