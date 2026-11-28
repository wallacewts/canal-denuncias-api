import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { DomainError } from '../../common/http/domain-error.js';
import type { StaffUser } from '../../infra/auth/staff-user.js';
import { AuditAction, AuditResourceType } from '../audit/audit-action.enum.js';
import { AuditService } from '../audit/audit.service.js';
import { allowsReport, reportScope, type ReportAbility, type ReportAccessFacts } from './report-scope.js';

/**
 * Uma única consulta, com a mesma forma exista ou não a denúncia (D59): a linha de `VALUES` sempre volta, e as duas
 * buscas são por chave (PK de `reports`, PK composta de `report_access_blocks`). Nenhum conteúdo é lido.
 */
const FACTS_SQL = `
  SELECT r.id IS NOT NULL AS exists,
         r.assigned_to_id::text AS assigned_to_id,
         r.shredded_at,
         b.user_id IS NOT NULL AS blocked
    FROM (VALUES ($1::uuid)) AS q(id)
    LEFT JOIN reports r ON r.id = q.id
    LEFT JOIN report_access_blocks b ON b.report_id = q.id AND b.user_id = $2::uuid`;

interface FactsRow {
  exists: boolean;
  assigned_to_id: string | null;
  shredded_at: Date | null;
  blocked: boolean;
}

/**
 * Ponto único de acesso a uma denúncia por id (ACL-02, ACL-04, D59, D62): toda rota de denúncia por registro passa
 * por aqui depois de a rota declarar a habilidade. Fora do escopo e inexistente respondem o mesmo 404, com a mesma
 * consulta e o mesmo registro na trilha (só o `reason` muda), para que nem o corpo nem o tempo revelem a existência.
 * O escopo vem antes do expurgo: 410 só para quem alcança a denúncia.
 */
@Injectable()
export class ReportAccessService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /**
   * @param reportId já validado como UUID pela rota (400 antes, sem auditoria).
   * @param options.content a operação precisa do conteúdo: denúncia expurgada dentro do escopo responde 410.
   */
  async resolve(
    user: StaffUser,
    reportId: string,
    ability: ReportAbility,
    options: { content?: boolean } = {},
  ): Promise<ReportAccessFacts> {
    const [row] = (await this.dataSource.query(FACTS_SQL, [reportId, user.id])) as FactsRow[];
    const facts: ReportAccessFacts = {
      reportId,
      exists: Boolean(row?.exists),
      assignedToId: row?.assigned_to_id ?? null,
      blockedForUser: Boolean(row?.blocked),
      shreddedAt: row?.shredded_at ?? null,
    };
    if (!allowsReport(reportScope(user, ability), facts)) {
      await this.audit.record({
        action: AuditAction.ACCESS_DENIED,
        resourceType: AuditResourceType.REPORT,
        resourceId: reportId,
        result: AuditResult.DENIED,
        metadata: { code: ability, reason: facts.exists ? 'OUT_OF_SCOPE' : 'NOT_FOUND' },
      });
      throw new NotFoundException('Denúncia não encontrada.');
    }
    if (options.content && facts.shreddedAt) {
      throw new DomainError(410, 'REPORT_SHREDDED', 'O conteúdo desta denúncia foi expurgado.');
    }
    return facts;
  }
}
