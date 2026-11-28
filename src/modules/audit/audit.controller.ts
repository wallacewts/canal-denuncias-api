import { Get, HttpCode, Post, Query } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { AdminApi } from '../../common/http/route-decorators.js';
import { AuditPolicy } from '../access-control/policies/audit.policy.js';
import { AuditAction, AuditResourceType } from './audit-action.enum.js';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { AuditQueryService, auditLogQuerySchema, usedFilters, type AuditLogQuery } from './audit-query.service.js';
import { AuditVerifierService } from './audit-verifier.service.js';
import { AuditService } from './audit.service.js';

/**
 * Rotas do Auditor (contracts/admin-audit-api.md). Só quem tem `audit.read` (o AUDITOR, D25) lê e verifica a trilha;
 * a recusa (403) vem da declaração da rota e o `ACCESS_DENIED` é gravado pelo assinante (feature 007, FR-005). A
 * `AuditPolicy` é descoberta pelo registro do pacote: este módulo não importa o `AccessControlModule`.
 */
@Can(AuditPolicy, 'read')
@AdminApi('audit-logs')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly queries: AuditQueryService,
    private readonly verifier: AuditVerifierService,
  ) {}

  @Get()
  async list(@Query({ schema: auditLogQuerySchema }) query: AuditLogQuery) {
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
  async verify() {
    return this.verifier.verifyAndRecord();
  }
}
