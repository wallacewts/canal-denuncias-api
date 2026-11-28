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
        }
        if (stopped) break;
        last = String(rows.at(-1)!.id);
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

  /** De onde a cadeia parte. Sem expurgo, da gênese (a âncora entra na US7). */
  protected startOfChain(_manager: EntityManager): Promise<{ prevHash: Buffer; anchoredAt: string | null }> {
    return Promise.resolve({ prevHash: GENESIS_HASH, anchoredAt: null });
  }
}
