import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { ActorType } from '../../common/enums/actor-type.enum.js';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { KEY_SERVICE, type KeyService } from '../../infra/vault/key-service.js';
import { KeyServiceRequestError } from '../../infra/vault/key-service.errors.js';
import { AuditService } from '../audit/audit.service.js';
import { Report } from '../reports/entities/report.entity.js';

const KEK = 'report-kek';
const FIRST_ID = '00000000-0000-0000-0000-000000000000';
export const DEFAULT_REWRAP_BATCH = 200;

export interface RewrapOptions {
  batchSize?: number;
  /** Interrupção (SIGINT/SIGTERM): a execução para depois do lote atual. */
  signal?: AbortSignal;
  /** Ganchos de teste: depois do rewrap no Vault e antes da transação do lote. */
  beforeBatchCommit?: (ids: string[]) => void | Promise<void>;
  /** Ganchos de teste: dentro da transação do lote, depois dos UPDATEs e antes da auditoria. */
  inBatchTransaction?: (manager: EntityManager) => void | Promise<void>;
  /** Ganchos de teste: depois de cada lote confirmado. */
  onBatchCommitted?: () => void;
}

export interface RewrapResult {
  latestVersion: number;
  batches: number;
  rewrapped: number;
  skipped: number;
  failed: number;
  /** false quando a execução foi interrompida antes de percorrer tudo. */
  completed: boolean;
}

/**
 * Recifragem das chaves das denúncias depois de girar a `report-kek` (CRYPTO-06, R7, contracts/cli-rewrap-keys.md).
 * Roda com o perfil de manutenção (D43). Para cada lote: rewrap no Vault fora de transação; depois uma transação com os
 * UPDATEs condicionais e o `KEYS_REWRAPPED` do lote (princípio V). No fim, sempre, o resumo `KEYS_REWRAP_RUN`.
 * Retomável: só percorre as chaves que ainda não estão na versão atual.
 */
@Injectable()
export class RewrapService {
  constructor(
    @Inject(KEY_SERVICE) private readonly keys: KeyService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async run(options: RewrapOptions = {}): Promise<RewrapResult> {
    const batchSize = options.batchSize ?? DEFAULT_REWRAP_BATCH;
    const result: RewrapResult = {
      latestVersion: 0,
      batches: 0,
      rewrapped: 0,
      skipped: 0,
      failed: 0,
      completed: false,
    };
    let crashed = false;
    try {
      result.latestVersion = await this.keys.latestVersion(KEK);
      const current = `vault:v${result.latestVersion}:%`;
      let cursor = FIRST_ID;
      for (;;) {
        if (options.signal?.aborted) return result;
        const rows = (await this.dataSource.query(
          `SELECT id, convert_from(wrapped_dek, 'UTF8') AS wrapped FROM reports
            WHERE id > $1 AND wrapped_dek IS NOT NULL AND convert_from(wrapped_dek, 'UTF8') NOT LIKE $2
            ORDER BY id LIMIT $3`,
          [cursor, current, batchSize],
        )) as Array<{ id: string; wrapped: string }>;
        if (rows.length === 0) {
          result.completed = true;
          return result;
        }
        cursor = rows[rows.length - 1].id;
        await this.processBatch(rows, result, options);
      }
    } catch (error) {
      crashed = true;
      throw error;
    } finally {
      await this.audit.record({
        actorType: ActorType.SYSTEM,
        action: 'KEYS_REWRAP_RUN',
        resourceType: 'kek',
        resourceId: KEK,
        result: !crashed && result.completed && result.failed === 0 ? AuditResult.SUCCESS : AuditResult.FAILURE,
        metadata: {
          latestVersion: result.latestVersion,
          batches: result.batches,
          rewrapped: result.rewrapped,
          skipped: result.skipped,
          failed: result.failed,
        },
      });
    }
  }

  private async processBatch(
    rows: Array<{ id: string; wrapped: string }>,
    result: RewrapResult,
    options: RewrapOptions,
  ): Promise<void> {
    // 1. Vault, fora de transação (nada de HTTP dentro de transação).
    const changes: Array<{ id: string; old: string; next: string }> = [];
    for (const row of rows) {
      try {
        changes.push({ id: row.id, old: row.wrapped, next: await this.keys.rewrap(KEK, row.wrapped) });
      } catch (error) {
        // Valor recusado pelo Vault (ex.: corrompido): conta como falha e segue. Sem permissão ou Vault fora do ar:
        // interrompe a execução inteira.
        if (error instanceof KeyServiceRequestError && error.vaultStatus !== 403) {
          result.failed++;
          continue;
        }
        throw error;
      }
    }
    await options.beforeBatchCommit?.(changes.map((c) => c.id));

    // 2. Uma transação por lote: UPDATEs condicionais e auditoria do lote juntos (princípio V).
    const batch = result.batches + 1;
    const counts = await this.dataSource.transaction(async (manager) => {
      let rewrapped = 0;
      let skipped = 0;
      for (const change of changes) {
        const update = await manager
          .createQueryBuilder()
          .update(Report)
          .set({ wrappedDek: Buffer.from(change.next, 'utf8') })
          .where('id = :id AND wrapped_dek = :old', { id: change.id, old: Buffer.from(change.old, 'utf8') })
          .execute();
        if (update.affected) rewrapped++;
        else skipped++;
      }
      await options.inBatchTransaction?.(manager);
      await this.audit.record(
        {
          actorType: ActorType.SYSTEM,
          action: 'KEYS_REWRAPPED',
          resourceType: 'kek',
          resourceId: KEK,
          result: AuditResult.SUCCESS,
          metadata: { latestVersion: result.latestVersion, batch, rewrapped, skipped },
        },
        manager,
      );
      return { rewrapped, skipped };
    });
    result.batches = batch;
    result.rewrapped += counts.rewrapped;
    result.skipped += counts.skipped;
    options.onBatchCommitted?.();
  }
}
