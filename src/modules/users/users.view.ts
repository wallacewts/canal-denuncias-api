import { Role } from '../../common/enums/role.enum.js';
import type { UserStatus } from '../../common/enums/user-status.enum.js';
import type { User } from './entities/user.entity.js';

/** Pessoa da equipe como as rotas devolvem (contracts/users-api.md): nunca hash, segredo de MFA ou códigos. */
export interface StaffUserView {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  status: UserStatus;
  mfaEnabled: boolean;
  passwordChangeRequired: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const ROLE_ORDER = Object.values(Role);

export function sortRoles(roles: readonly Role[]): Role[] {
  return [...roles].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
}

export function toStaffUserView(user: User): StaffUserView {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roles: sortRoles((user.roles ?? []).map((r) => r.role)),
    status: user.status,
    mfaEnabled: user.mfaEnabledAt !== null,
    passwordChangeRequired: user.passwordChangedAt === null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
