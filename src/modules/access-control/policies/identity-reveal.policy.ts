import { Policy } from '@nestjs/authorization';
import type { StaffUser } from '../../../infra/auth/staff-user.js';
import { hasAbility } from '../abilities.js';
import { allowsReport, reportScope, type ReportAccessFacts } from '../report-scope.js';

/** O que a decisão precisa saber do pedido: quem pediu (four-eyes; o banco confere o mesmo, CHECK `reveal_four_eyes`). */
export interface RevealRequestFacts {
  requestedById: string;
}

/** Revelação de identidade (ACL-01): pedir como quem trata; decidir só o DPO, nunca o próprio pedido. */
@Policy()
export class IdentityRevealPolicy {
  requestAny(user: StaffUser | null): boolean {
    return hasAbility(user, 'identity.request');
  }

  decideAny(user: StaffUser | null): boolean {
    return hasAbility(user, 'identity.approve');
  }

  request(user: StaffUser | null, report: ReportAccessFacts): boolean {
    return allowsReport(reportScope(user, 'identity.request'), report);
  }

  decide(user: StaffUser | null, report: ReportAccessFacts, request: RevealRequestFacts): boolean {
    if (!user || request.requestedById.toLowerCase() === user.id.toLowerCase()) return false;
    return allowsReport(reportScope(user, 'identity.approve'), report);
  }
}
