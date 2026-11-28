import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import type { ActorType } from '../../common/enums/actor-type.enum.js';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { AuditAction, AuditResourceType } from './audit-action.enum.js';
import { computeAuditHash, GENESIS_HASH, type AuditHashInput } from './audit-hash.js';
import { AuditService } from './audit.service.js';

/** Um registro da trilha como a verificação o lê. */
export interface ChainRow extends AuditHashInput {
  id: string;
  prevHash: Buffer;
  hash: Buffer;
}

export interface ChainWalkResult {
  ok: boolean;
  checked: number;
  firstBrokenId: string | null;
}

/** Resultado devolvido pela rota e pelo comando (contracts/admin-audit-api.md). */
export interface VerificationResult extends ChainWalkResult {
  /** Id do registro-âncora quando a cadeia começa depois de um expurgo (US7); senão, `null`. */
  anchoredAt: string | null;
}

export interface VerifyOptions {
  batchSize?: number;
  /** Só para testes: chamado a cada lote (medição de memória). */
  onBatch?: () => void;
  /** Só para testes: chamado logo depois de fixar o ponto de corte. */
  afterCutoff?: () => Promise<void>;
}

const DEFAULT_BATCH = 1000;

interface AnchorRow {
  partition_name: string;
  rows_removed: string;
  anchor_audit_id: string | null;
  anchor_prev_hash: Buffer | null;
  purged_through: Date;
  purged_at: Date;
}

interface ChainStart {
  prevHash: Buffer;
  anchoredAt: string | null;
  anchor: AnchorRow | null;
}

function fiveYearsBefore(date: Date): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() - 5);
  return d;
}

/**
 * Percorre a cadeia registro a registro: o `prev_hash` de cada um precisa ser o hash do anterior, e o hash precisa
 * bater com o conteúdo. Para no primeiro registro quebrado. Função pura, sem banco.
 */
export class ChainWalker {
  private checked = 0;
  private brokenId: string | null = null;

  constructor(private expectedPrev: Buffer) {}

  step(row: ChainRow): boolean {
    if (this.brokenId) return false;
    if (!row.prevHash.equals(this.expectedPrev) || !computeAuditHash(row.prevHash, row).equals(row.hash)) {
      this.brokenId = row.id;
      return false;
    }
    this.expectedPrev = row.hash;
    this.checked += 1;
    return true;
  }

  result(): ChainWalkResult {
    return { ok: this.brokenId === null, checked: this.checked, firstBrokenId: this.brokenId };
  }
}

interface RawRow {
  id: string | number;
  occurred_at: Date;
  actor_type: ActorType;
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  result: AuditResult;
  ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  prev_hash: Buffer;
  hash: Buffer;
}

function toChainRow(r: RawRow): ChainRow {
  return {
    id: String(r.id),
    occurredAt: r.occurred_at,
    actorType: r.actor_type,
    actorUserId: r.actor_user_id,
    action: r.action,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    result: r.result,
    ip: r.ip,
    userAgent: r.user_agent,
    metadata: r.metadata,
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}

/** O registro `AUDIT_LOG_PURGED` do expurgo que gerou a âncora: mesma partição e mesmo total. */
function isPurgeRecordOf(row: RawRow, anchor: AnchorRow): boolean {
  return (
    row.action === AuditAction.AUDIT_LOG_PURGED &&
    row.metadata?.['partition'] === anchor.partition_name &&
    String(row.metadata?.['rowsRemoved']) === anchor.rows_removed
  );
}

/**
 * Verificação de integridade da cadeia (AUDIT-07). Fixa um ponto de corte no início (o maior id existente), lê em
 * lotes por id crescente numa transação `REPEATABLE READ READ ONLY` (fotografia consistente, sem bloquear gravações) e
 * nunca altera nenhum registro. O registro da verificação é gravado depois, em transação própria (pendência U3).
 */
@Injectable()
export class AuditVerifierService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async verify(options: VerifyOptions = {}): Promise<VerificationResult> {
    const batchSize = options.batchSize ?? DEFAULT_BATCH;
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const [{ cutoff }] = (await manager.query(`SELECT max(id)::text AS cutoff FROM audit_logs`)) as Array<{
        cutoff: string | null;
      }>;
      await options.afterCutoff?.();
      if (!cutoff) return { ok: true, checked: 0, firstBrokenId: null, anchoredAt: null };

      const start = await this.startOfChain(manager);
      const walker = new ChainWalker(start.prevHash);
      let purgeRecordFound = start.anchor === null;
      let last = '0';
      for (;;) {
        const rows = (await manager.query(`SELECT * FROM audit_logs WHERE id > $1 AND id <= $2 ORDER BY id LIMIT $3`, [
          last,
          cutoff,
          batchSize,
        ])) as RawRow[];
        if (rows.length === 0) break;
        options.onBatch?.();
        let stopped = false;
        for (const row of rows) {
          if (!walker.step(toChainRow(row))) {
            stopped = true;
            break;
          }
          if (!purgeRecordFound && isPurgeRecordOf(row, start.anchor!)) purgeRecordFound = true;
        }
        if (stopped) break;
        last = String(rows.at(-1)!.id);
      }
      const walked = walker.result();
      // A âncora só vale se o AUDIT_LOG_PURGED correspondente estiver na cadeia verificada (R9).
      if (walked.ok && !purgeRecordFound) {
        return { ok: false, checked: walked.checked, firstBrokenId: start.anchoredAt, anchoredAt: null };
      }
      return { ...walker.result(), anchoredAt: start.anchoredAt };
    });
  }

  /** Verifica e registra `AUDIT_CHAIN_VERIFIED` (rota e comando). O ator vem do contexto. */
  async verifyAndRecord(): Promise<VerificationResult> {
    const result = await this.verify();
    await this.audit.record({
      action: AuditAction.AUDIT_CHAIN_VERIFIED,
      resourceType: AuditResourceType.AUDIT_LOG,
      result: AuditResult.SUCCESS,
      metadata: {
        ok: result.ok,
        checked: result.checked,
        ...(result.firstBrokenId ? { firstBrokenId: result.firstBrokenId } : {}),
        anchored: result.anchoredAt !== null,
      },
    });
    return result;
  }

  /**
   * De onde a cadeia parte (R9). Sem expurgo, da gênese. Depois de um expurgo, do primeiro registro restante, mas só se
   * a âncora mais recente de `audit_purges` (gravada apenas pela função de expurgo) apontar para ele, com o mesmo
   * `prev_hash` e o prazo de 5 anos respeitado. Qualquer outra lacuna no início faz o primeiro registro quebrar.
   */
  protected async startOfChain(manager: EntityManager): Promise<ChainStart> {
    const [first] = (await manager.query(
      // Ordena pelo id numérico da tabela, não pelo alias em texto ("10" viria antes de "5").
      `SELECT l.id::text AS id, l.occurred_at, l.prev_hash FROM audit_logs l ORDER BY l.id LIMIT 1`,
    )) as Array<{ id: string; occurred_at: Date; prev_hash: Buffer }>;
    if (!first || first.prev_hash.equals(GENESIS_HASH))
      return { prevHash: GENESIS_HASH, anchoredAt: null, anchor: null };

    const [anchor] = (await manager.query(
      `SELECT partition_name, rows_removed::text AS rows_removed, anchor_audit_id::text AS anchor_audit_id,
              anchor_prev_hash, purged_through, purged_at
       FROM audit_purges ORDER BY id DESC LIMIT 1`,
    )) as Array<AnchorRow>;
    const valid =
      anchor !== undefined &&
      anchor.anchor_audit_id === first.id &&
      anchor.anchor_prev_hash !== null &&
      anchor.anchor_prev_hash.equals(first.prev_hash) &&
      anchor.purged_through.getTime() <= fiveYearsBefore(anchor.purged_at).getTime() &&
      first.occurred_at.getTime() >= anchor.purged_through.getTime();
    // Âncora inválida: a caminhada parte da gênese e quebra no primeiro registro.
    if (!valid) return { prevHash: GENESIS_HASH, anchoredAt: null, anchor: null };
    return { prevHash: first.prev_hash, anchoredAt: first.id, anchor };
  }
}
