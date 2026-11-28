import { Policy } from '@nestjs/authorization';
import type { StaffUser } from '../../../infra/auth/staff-user.js';
import { hasAbility } from '../abilities.js';
import { allowsReport, reportScope, type ReportAccessFacts } from '../report-scope.js';

/**
 * Regras das denúncias (ACL-01, ACL-02, D62). Métodos `*Any`/`list` vão na rota (`@Can()`): sem a habilidade, 403 —
 * quem não a tem não alcança nenhuma denúncia, não há existência a esconder. Métodos por registro recebem os fatos do
 * `ReportAccessService.resolve` (que já respondeu 404 fora do escopo de leitura) e decidem a operação pela função de
 * escopo única; bloqueio por conflito nega sempre.
 */
@Policy()
export class ReportsPolicy {
  list(user: StaffUser | null): boolean {
    return hasAbility(user, 'reports.list');
  }

  readAny(user: StaffUser | null): boolean {
    return hasAbility(user, 'reports.read');
  }

  triageAny(user: StaffUser | null): boolean {
    return hasAbility(user, 'reports.triage');
  }

  treatAny(user: StaffUser | null): boolean {
    return hasAbility(user, 'reports.treat');
  }

  read(user: StaffUser | null, report: ReportAccessFacts): boolean {
    return allowsReport(reportScope(user, 'reports.read'), report);
  }

  /** Triar, atribuir, priorizar e bloquear por conflito. */
  triage(user: StaffUser | null, report: ReportAccessFacts): boolean {
    return allowsReport(reportScope(user, 'reports.triage'), report);
  }

  /** Mudar status, mensagens e notas: Gestora ou Analista atribuído; o DPO nunca (D20). */
  treat(user: StaffUser | null, report: ReportAccessFacts): boolean {
    return allowsReport(reportScope(user, 'reports.treat'), report);
  }
}
