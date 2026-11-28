import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Partições da trilha à frente (US7, R7). Sem partição, uma gravação na trilha falha e a operação auditada é
 * desfeita, então:
 * - sem a partição do mês corrente ou do seguinte: `down` (503), a API sai de rotação;
 * - só com o mês corrente e o seguinte (menos de 1 mês à frente): `up` com aviso, para o `audit-maintenance` rodar;
 * - mais que isso: `up`.
 */
@Injectable()
export class AuditPartitionsIndicator {
  constructor(
    private readonly indicator: HealthIndicatorService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async check(key = 'auditPartitions') {
    const session = this.indicator.check(key);
    const rows = (await this.dataSource.query(
      `SELECT i, to_regclass('public.audit_logs_' ||
                 to_char(date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i), 'YYYY_MM'))
                 IS NOT NULL AS present
       FROM generate_series(0, 24) AS i ORDER BY i`,
    )) as Array<{ i: number; present: boolean }>;
    // Meses consecutivos cobertos a partir do mês corrente.
    const firstGap = rows.findIndex((r) => !r.present);
    const covered = firstGap === -1 ? rows.length : firstGap;
    const monthsAhead = Math.max(covered - 1, 0);
    if (covered < 2) return session.down({ monthsAhead });
    if (covered === 2) return session.up({ monthsAhead, warning: 'Menos de 1 mês de partições à frente.' });
    return session.up({ monthsAhead });
  }
}
