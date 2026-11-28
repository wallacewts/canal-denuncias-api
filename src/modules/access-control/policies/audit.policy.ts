import { Policy } from '@nestjs/authorization';
import type { StaffUser } from '../../../infra/auth/staff-user.js';
import { hasAbility } from '../abilities.js';

/** Trilha de auditoria (D25): só o AUDITOR lê e verifica. */
@Policy()
export class AuditPolicy {
  read(user: StaffUser | null): boolean {
    return hasAbility(user, 'audit.read');
  }
}
