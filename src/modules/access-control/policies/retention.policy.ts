import { Policy } from '@nestjs/authorization';
import type { StaffUser } from '../../../infra/auth/staff-user.js';
import { hasAbility } from '../abilities.js';
import { allowsReport, reportScope, type ReportAccessFacts } from '../report-scope.js';

/** Retenção e legal hold (ACL-01): só o DPO; sobre uma denúncia, respeitando o bloqueio por conflito. */
@Policy()
export class RetentionPolicy {
  manage(user: StaffUser | null): boolean {
    return hasAbility(user, 'retention.manage');
  }

  manageReport(user: StaffUser | null, report: ReportAccessFacts): boolean {
    return allowsReport(reportScope(user, 'retention.manage'), report);
  }
}
