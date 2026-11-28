import { Command, CommandRunner, Option } from 'nest-commander';
import { AuditMaintenanceService } from '../modules/audit/audit-maintenance.service.js';
import { CliOutput } from './cli-output.js';

export interface AuditMaintenanceOptions {
  dryRun?: boolean;
}

/**
 * `audit-maintenance` (AUDIT-09, contracts/cli-audit.md): garante 3 meses de partições à frente e remove as partições
 * da trilha que passaram de 5 anos. Feito para rodar uma vez por dia por agendador do sistema, fora da API, com o
 * perfil `app_audit_maintenance` (`DATABASE_AUDIT_MAINTENANCE_URL`). Saída: uma linha JSON com os totais. Código 0
 * sucesso, 1 recusa ou erro, sempre com mensagem fixa (sem detalhes do banco).
 */
@Command({
  name: 'audit-maintenance',
  description: 'Cria as partições da trilha à frente e expurga as que passaram de 5 anos (perfil de manutenção).',
})
export class AuditMaintenanceCommand extends CommandRunner {
  constructor(
    private readonly maintenance: AuditMaintenanceService,
    private readonly output: CliOutput,
  ) {
    super();
  }

  async run(_params: string[], options: AuditMaintenanceOptions): Promise<void> {
    process.exitCode = await this.execute(options);
  }

  @Option({ flags: '--dry-run', description: 'Mostra o que faria, sem alterar nada' })
  parseDryRun(): boolean {
    return true;
  }

  async execute(options: AuditMaintenanceOptions): Promise<number> {
    const url = process.env.DATABASE_AUDIT_MAINTENANCE_URL;
    if (!url) {
      this.output.error('Defina DATABASE_AUDIT_MAINTENANCE_URL com o perfil de manutenção da trilha.');
      return 1;
    }
    try {
      const result = await this.maintenance.run({
        url,
        ssl: process.env.DATABASE_SSL === 'true',
        dryRun: options.dryRun ?? false,
      });
      this.output.info(JSON.stringify(result));
      return 0;
    } catch {
      this.output.error('A manutenção da trilha falhou. Confira o perfil de manutenção e rode de novo.');
      return 1;
    }
  }
}
