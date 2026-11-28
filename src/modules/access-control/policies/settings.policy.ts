import { Policy } from '@nestjs/authorization';
import type { StaffUser } from '../../../infra/auth/staff-user.js';
import { hasAbility } from '../abilities.js';

/** Parâmetros do sistema (ACL-01, CAT-03): SLA e prazos pelo ADMIN; prazo de retenção pelo DPO. */
@Policy()
export class SettingsPolicy {
  sla(user: StaffUser | null): boolean {
    return hasAbility(user, 'settings.sla');
  }

  retention(user: StaffUser | null): boolean {
    return hasAbility(user, 'retention.manage');
  }
}
