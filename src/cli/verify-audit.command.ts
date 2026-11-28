import { Command, CommandRunner } from 'nest-commander';
import { runAsSystem } from '../modules/audit/audit-context.js';
import { AuditVerifierService } from '../modules/audit/audit-verifier.service.js';
import { CliOutput } from './cli-output.js';

/**
 * `verify-audit` (AUDIT-07, contracts/cli-audit.md): verifica a cadeia da trilha e imprime uma linha JSON com o
 * resultado. Código de saída 0 íntegra, 1 quebrada, 2 erro de execução. Feito para agendamento: um código diferente de
 * zero deve gerar alerta. Roda com o perfil da API (`DATABASE_URL`), que só lê a trilha e grava o registro da
 * verificação.
 */
@Command({ name: 'verify-audit', description: 'Verifica a integridade da cadeia da trilha de auditoria.' })
export class VerifyAuditCommand extends CommandRunner {
  constructor(
    private readonly verifier: AuditVerifierService,
    private readonly output: CliOutput,
  ) {
    super();
  }

  async run(): Promise<void> {
    process.exitCode = await this.execute();
  }

  /** Executa com ator sistema e devolve o código de saída. */
  async execute(): Promise<number> {
    try {
      const result = await runAsSystem(() => this.verifier.verifyAndRecord());
      this.output.info(JSON.stringify(result));
      return result.ok ? 0 : 1;
    } catch {
      this.output.error('Não foi possível verificar a trilha de auditoria.');
      return 2;
    }
  }
}
