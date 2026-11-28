import { Policy } from '@nestjs/authorization';
import type { StaffUser } from '../../../infra/auth/staff-user.js';
import { hasAbility } from '../abilities.js';

/** Indicadores agregados (ACL-01, REPT): Gestora, DPO e AUDITOR, sem conteúdo de denúncia. */
@Policy()
export class DashboardPolicy {
  read(user: StaffUser | null): boolean {
    return hasAbility(user, 'dashboard.read');
  }
}
