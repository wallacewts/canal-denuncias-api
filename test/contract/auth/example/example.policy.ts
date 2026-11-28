import { Policy } from '@nestjs/authorization';
import { Role } from '../../../../src/common/enums/role.enum.js';
import type { StaffUser } from '../../../../src/infra/auth/staff-user.js';
import {
  allowsReport,
  reportScope,
  type ReportAbility,
  type ReportAccessFacts,
} from '../../../../src/modules/access-control/report-scope.js';
import type { ScopedReport } from './example.repository.js';

const facts = (user: StaffUser, report: ScopedReport): ReportAccessFacts => ({
  reportId: report.id,
  exists: true,
  assignedToId: report.assignedToId,
  blockedForUser: report.blockedUserIds.includes(user.id),
  shreddedAt: null,
});

const allows = (user: StaffUser, ability: ReportAbility, report: ScopedReport) =>
  allowsReport(reportScope(user, ability), facts(user, report));

/**
 * Política de exemplo SÓ DE TESTE com as regras do ACL-01 que a decisão da feature 004 provou (US3). As regras por
 * registro usam a função de escopo real da feature 007 (sem cópia da regra em `test/`).
 */
@Policy()
export class ExamplePolicy {
  /** Só o Gestor de compliance. */
  manage(user: StaffUser | null): boolean {
    return Boolean(user?.roles.includes(Role.COMPLIANCE_MANAGER));
  }

  /** Quem pode abrir a listagem (o que cada um vê vem da consulta filtrada). */
  list(user: StaffUser | null): boolean {
    return reportScope(user, 'reports.list').kind !== 'none';
  }

  read(user: StaffUser, report: ScopedReport): boolean {
    return allows(user, 'reports.read', report);
  }

  /** Tratar: Gestor ou Analista atribuído; o DPO só lê (D20). */
  treat(user: StaffUser, report: ScopedReport): boolean {
    return allows(user, 'reports.treat', report);
  }

  /** Administrador altera perfis de outra pessoa, nunca os próprios (D21). */
  changeRoles(user: StaffUser | null, targetUserId: string): boolean {
    return Boolean(user?.roles.includes(Role.ADMIN) && user.id !== targetUserId);
  }
}
