import { Command, CommandRunner, Option } from 'nest-commander';
import { z } from 'zod';
import { KeyServiceRequestError, KeyServiceUnavailableError } from '../infra/vault/key-service.errors.js';
import { DEFAULT_REWRAP_BATCH, RewrapService } from '../modules/crypto/rewrap.service.js';
import { CliOutput } from './cli-output.js';

export interface RewrapKeysOptions {
  kek?: string;
  batchSize?: string;
}

const optionsSchema = z.object({
  kek: z.literal('report-kek'),
  batchSize: z.coerce.number().int().min(1).max(1000).default(DEFAULT_REWRAP_BATCH),
});

/**
 * `rewrap-keys` (CRYPTO-06, contracts/cli-rewrap-keys.md): recifra as chaves das denúncias depois de girar a
 * `report-kek`. Roda com o perfil de manutenção (`VAULT_TOKEN=` vazio e o AppRole `maintenance`). A saída tem só
 * números e a versão; nunca valores de chave nem ids de denúncia.
 */
@Command({
  name: 'rewrap-keys',
  description: 'Recifra as chaves das denúncias com a versão atual da KEK (perfil de manutenção).',
})
export class RewrapKeysCommand extends CommandRunner {
  constructor(
    private readonly rewrap: RewrapService,
    private readonly output: CliOutput,
  ) {
    super();
  }

  async run(_params: string[], options: RewrapKeysOptions): Promise<void> {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      process.exitCode = await this.execute(options, controller.signal);
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  }

  @Option({ flags: '--kek <kek>', description: 'KEK a recifrar (só report-kek)', required: true })
  parseKek(value: string): string {
    return value;
  }

  @Option({ flags: '--batch-size <n>', description: 'Registros por lote (1 a 1000, padrão 200)' })
  parseBatchSize(value: string): string {
    return value;
  }

  /** Executa e devolve o código de saída (0 sucesso, 1 recusa ou falha). */
  async execute(options: RewrapKeysOptions, signal?: AbortSignal): Promise<number> {
    const parsed = optionsSchema.safeParse(options);
    if (!parsed.success) {
      this.output.error('Use --kek report-kek e, se quiser, --batch-size de 1 a 1000.');
      return 1;
    }
    try {
      const r = await this.rewrap.run({ batchSize: parsed.data.batchSize, signal });
      if (!r.completed) {
        this.output.error(
          `Interrompido. Recifradas: ${r.rewrapped}. Ignoradas: ${r.skipped}. Falhas: ${r.failed}. Rode de novo para terminar.`,
        );
        return 1;
      }
      if (r.rewrapped + r.skipped + r.failed === 0) {
        this.output.info(`Nada a recifrar. Versão atual: v${r.latestVersion}.`);
        return 0;
      }
      const line = `Recifradas: ${r.rewrapped}. Ignoradas: ${r.skipped}. Falhas: ${r.failed}. Versão atual: v${r.latestVersion}.`;
      if (r.failed > 0) {
        this.output.error(line);
        return 1;
      }
      this.output.info(line);
      return 0;
    } catch (error) {
      if (
        error instanceof KeyServiceUnavailableError ||
        (error instanceof KeyServiceRequestError && error.vaultStatus === 403)
      ) {
        this.output.error('Serviço de chaves indisponível ou sem permissão.');
        return 1;
      }
      this.output.error('Falha na recifragem. Nenhum lote incompleto foi gravado; rode de novo.');
      return 1;
    }
  }
}
