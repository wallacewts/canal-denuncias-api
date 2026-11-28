import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { StaffUser } from '../../../../src/infra/auth/staff-user.js';
import { reportScope, toSql, type ScopedReport } from './report-scope.js';

/** Repositório de exemplo SÓ DE TESTE: a listagem é filtrada NA CONSULTA pela mesma função de escopo (FR-018). */
@Injectable()
export class ExampleReportRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async findVisibleTo(user: StaffUser): Promise<string[]> {
    const { where, params } = toSql(reportScope(user));
    const rows = (await this.ds.query(`SELECT r.id FROM reports r WHERE ${where} ORDER BY r.id`, params)) as Array<{
      id: string;
    }>;
    return rows.map((r) => r.id);
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
