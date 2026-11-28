import { ForbiddenException, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { Role } from '../../common/enums/role.enum.js';
import { AdminApi } from '../../common/http/route-decorators.js';
import type { RequestWithIdentity } from '../../infra/auth/admin-identity.guard.js';
import { AuditAction, AuditResourceType } from './audit-action.enum.js';
import { AuditQueryService, auditLogQuerySchema, usedFilters, type AuditLogQuery } from './audit-query.service.js';
import { AuditVerifierService } from './audit-verifier.service.js';
import { AuditService } from './audit.service.js';

/** Rotas do Auditor (contracts/admin-audit-api.md). Só o perfil AUDITOR lê a trilha (D25). */
// O perfil AUDITOR é checado em cada handler (com ACCESS_DENIED próprio); vira política no access-control (ACL-01).
@Can.Anyone()
@AdminApi('audit-logs')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly queries: AuditQueryService,
    private readonly verifier: AuditVerifierService,
  ) {}

  @Get()
  async list(@Req() request: RequestWithIdentity, @Query({ schema: auditLogQuerySchema }) query: AuditLogQuery) {
    await this.assertAuditor(request);
    const page = await this.queries.list(query);
    await this.audit.record({
      action: AuditAction.AUDIT_LOG_VIEWED,
      resourceType: AuditResourceType.AUDIT_LOG,
      result: AuditResult.SUCCESS,
      metadata: { filters: usedFilters(query), count: page.items.length },
    });
    return page;
  }

  /** Verifica a integridade da cadeia (AUDIT-07). Síncrona: 100 mil registros em menos de 1 minuto (SC-006). */
  @Post('verification')
  @HttpCode(200)
  async verify(@Req() request: RequestWithIdentity) {
    await this.assertAuditor(request);
    return this.verifier.verifyAndRecord();
  }

  /** Até a ACL-02 assumir as permissões, a checagem do perfil fica aqui e a recusa é registrada (FR-019). */
  private async assertAuditor(request: RequestWithIdentity): Promise<void> {
    if (request.staffIdentity?.roles.includes(Role.AUDITOR)) return;
    await this.audit.record({
      action: AuditAction.ACCESS_DENIED,
      resourceType: AuditResourceType.AUDIT_LOG,
      result: AuditResult.DENIED,
      metadata: { required: Role.AUDITOR },
    });
    throw new ForbiddenException();
  }
}
