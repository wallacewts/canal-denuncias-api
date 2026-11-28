import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { StaffUser } from '../../../../src/infra/auth/staff-user.js';
import { scopeReportsFor } from '../../../../src/modules/access-control/report-scope.js';
import { Report } from '../../../../src/modules/reports/entities/report.entity.js';

/** Denúncia como a política de exemplo a vê: atribuição e quem está bloqueado por conflito. */
export interface ScopedReport {
  id: string;
  assignedToId: string | null;
  blockedUserIds: string[];
}

/**
 * Repositório de exemplo SÓ DE TESTE (prova do pacote, feature 004): a listagem é filtrada NA CONSULTA pela função de
 * escopo real (`src/modules/access-control/report-scope.ts`, feature 007), não por uma cópia.
 */
@Injectable()
export class ExampleReportRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async findVisibleTo(user: StaffUser): Promise<string[]> {
    const qb = scopeReportsFor(user, this.ds.getRepository(Report).createQueryBuilder('r').select('r.id', 'id'));
    const [sql, params] = qb.orderBy('r.id').getQueryAndParameters();
    // Pelo `DataSource.query`, para o teste de contrato enxergar a consulta única já filtrada.
    return ((await this.ds.query(sql, params)) as Array<{ id: string }>).map((r) => r.id);
  }

  async findForCheck(id: string): Promise<ScopedReport | null> {
    const rows = (await this.ds.query(
      `SELECT r.id, r.assigned_to_id,
              COALESCE(array_agg(b.user_id) FILTER (WHERE b.user_id IS NOT NULL), '{}') AS blocked
       FROM reports r LEFT JOIN report_access_blocks b ON b.report_id = r.id
       WHERE r.id = $1 GROUP BY r.id`,
      [id],
    )) as Array<{ id: string; assigned_to_id: string | null; blocked: string[] }>;
    const row = rows[0];
    return row ? { id: row.id, assignedToId: row.assigned_to_id, blockedUserIds: row.blocked } : null;
  }
}
