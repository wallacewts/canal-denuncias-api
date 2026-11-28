import { Policy } from '@nestjs/authorization';
import type { StaffUser } from '../../../infra/auth/staff-user.js';
import { hasAbility } from '../abilities.js';

/**
 * Regras da área de usuários (feature 005, research R10). `manage`: gerenciar a equipe (`users.manage`).
 * `actOnOther`: alterar status, perfis ou MFA de outra pessoa, nunca de si mesmo (D21). Um id malformado não é a
 * própria pessoa: passa aqui e a validação do parâmetro responde 400.
 */
@Policy()
export class UsersPolicy {
  manage(user: StaffUser | null): boolean {
    return hasAbility(user, 'users.manage');
  }

  actOnOther(user: StaffUser | null, targetUserId: string | undefined): boolean {
    if (!user || !targetUserId) return false;
    return hasAbility(user, 'users.manage') && user.id.toLowerCase() !== targetUserId.toLowerCase();
  }
}
