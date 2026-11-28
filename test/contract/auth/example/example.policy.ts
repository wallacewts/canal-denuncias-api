import { Policy } from '@nestjs/authorization';
import { Role } from '../../../../src/common/enums/role.enum.js';
import type { StaffUser } from '../../../../src/infra/auth/staff-user.js';
import { allows, reportScope, type ScopedReport } from './report-scope.js';

/** Política de exemplo SÓ DE TESTE com as regras do ACL-01 que a decisão precisa provar (US3). */
@Policy()
export class ExamplePolicy {
  /** Só o Gestor de compliance. */
  manage(user: StaffUser | null): boolean {
    return Boolean(user?.roles.includes(Role.COMPLIANCE_MANAGER));
  }

  /** Quem pode abrir a listagem (o que cada um vê vem da consulta filtrada). */
  list(user: StaffUser | null): boolean {
    return Boolean(user && !reportScope(user).none);
  }

  read(user: StaffUser, report: ScopedReport): boolean {
    return allows(reportScope(user), report);
  }

  /** Tratar: Gestor ou Analista atribuído; o DPO só lê (D20). */
  treat(user: StaffUser, report: ScopedReport): boolean {
    if (!allows(reportScope(user), report)) return false;
    return user.roles.includes(Role.COMPLIANCE_MANAGER) || report.assignedToId === user.id;
  }

  /** Administrador altera perfis de outra pessoa, nunca os próprios (D21). */
  changeRoles(user: StaffUser | null, targetUserId: string): boolean {
    return Boolean(user?.roles.includes(Role.ADMIN) && user.id !== targetUserId);
  }
}
