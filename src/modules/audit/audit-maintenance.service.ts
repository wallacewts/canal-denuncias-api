import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { buildDataSourceOptions } from '../../database/database.options.js';
import { AuditAction, AuditResourceType } from './audit-action.enum.js';
import { runAsSystem } from './audit-context.js';
import { AuditService } from './audit.service.js';

/** Meses de partições garantidos à frente a cada execução (R10). */
export const PARTITIONS_AHEAD = 3;

export interface MaintenanceOptions {
  /** URL do perfil `app_audit_maintenance` (o comando lê de `DATABASE_AUDIT_MAINTENANCE_URL`). */
  url: string;
  ssl?: boolean;
  dryRun?: boolean;
  /** Só para testes: chamado dentro da transação de cada expurgo, antes do commit. */
  beforeCommit?: () => void | Promise<void>;
}

export interface MaintenanceResult {
  partitionsCreated: number;
  partitionsPurged: number;
  rowsRemoved: number;
}

/**
 * Manutenção da trilha (D50): garante as partições à frente e remove as que passaram de 5 anos, da mais antiga para a
 * mais nova. Usa uma conexão própria com o perfil de manutenção, nunca a da API. Cada expurgo e o seu
 * `AUDIT_LOG_PURGED` ficam na mesma transação (princípio V): se algo falhar, a partição, a âncora e o registro voltam
 * juntos.
 */
@Injectable()
export class AuditMaintenanceService {
  constructor(private readonly audit: AuditService) {}

  async run(options: MaintenanceOptions): Promise<MaintenanceResult> {
    const ds = await new DataSource({
      ...buildDataSourceOptions(options.url, options.ssl ?? false),
      logging: ['error'],
    }).initialize();
    try {
      const partitionsCreated = options.dryRun
        ? await this.missingAhead(ds)
        : Number(
            (
              (await ds.query(`SELECT audit_ensure_partitions($1) AS n`, [PARTITIONS_AHEAD])) as Array<{ n: number }>
            )[0]!.n,
          );

      let partitionsPurged = 0;
      let rowsRemoved = 0;
      for (const candidate of await this.expiredPartitions(ds)) {
        if (options.dryRun) {
          partitionsPurged += 1;
          rowsRemoved += candidate.rows;
          continue;
        }
        const removed = await ds.transaction((manager) =>
          runAsSystem(async () => {
            const [{ n }] = (await manager.query(`SELECT audit_purge_partition($1)::int AS n`, [
              candidate.name,
            ])) as Array<{
              n: number;
            }>;
            const [anchor] = (await manager.query(
              `SELECT purged_through, anchor_audit_id::text AS anchor_audit_id FROM audit_purges
               WHERE partition_name = $1 ORDER BY id DESC LIMIT 1`,
              [candidate.name],
            )) as Array<{ purged_through: Date; anchor_audit_id: string | null }>;
            await this.audit.record(
              {
                action: AuditAction.AUDIT_LOG_PURGED,
                resourceType: AuditResourceType.AUDIT_LOG,
                resourceId: candidate.name,
                result: AuditResult.SUCCESS,
                metadata: {
                  partition: candidate.name,
                  purgedThrough: anchor!.purged_through.toISOString(),
                  rowsRemoved: n,
                  ...(anchor!.anchor_audit_id ? { anchorAuditId: anchor!.anchor_audit_id } : {}),
                },
              },
              manager,
            );
            await options.beforeCommit?.();
            return n;
          }),
        );
        partitionsPurged += 1;
        rowsRemoved += removed;
      }
      return { partitionsCreated, partitionsPurged, rowsRemoved };
    } finally {
      await ds.destroy();
    }
  }

  /** Quantas partições do mês corrente até `PARTITIONS_AHEAD` meses à frente ainda não existem. */
  private async missingAhead(ds: DataSource): Promise<number> {
    const [{ n }] = (await ds.query(
      `SELECT count(*)::int AS n FROM generate_series(0, $1) AS i
       WHERE to_regclass('public.audit_logs_' ||
             to_char(date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i), 'YYYY_MM')) IS NULL`,
      [PARTITIONS_AHEAD],
    )) as Array<{ n: number }>;
    return n;
  }

  /**
   * Partições cujo limite superior passou de 5 anos + 1 dia, da mais antiga para a mais nova. A função de expurgo
   * confere tudo de novo no banco; esta lista só decide o que tentar.
   */
  private async expiredPartitions(ds: DataSource): Promise<Array<{ name: string; rows: number }>> {
    const partitions = (await ds.query(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
       WHERE p.relname = 'audit_logs' AND c.relname ~ '^audit_logs_[0-9]{4}_[0-9]{2}$'
         AND (to_date(substr(c.relname, 12), 'YYYY_MM') + interval '1 month')::timestamp AT TIME ZONE 'UTC'
             <= now() - interval '5 years' - interval '1 day'
       ORDER BY c.relname`,
    )) as Array<{ name: string }>;
    const result: Array<{ name: string; rows: number }> = [];
    for (const { name } of partitions) {
      const [{ n }] = (await ds.query(`SELECT count(*)::int AS n FROM audit_logs WHERE tableoid = $1::regclass`, [
        name,
      ])) as Array<{ n: number }>;
      result.push({ name, rows: n });
    }
    return result;
  }
}
