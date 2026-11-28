import type pg from 'pg';
import { ActorType } from '../../src/common/enums/actor-type.enum.js';
import { AuditResult } from '../../src/common/enums/audit-result.enum.js';
import { computeAuditHash, GENESIS_HASH } from '../../src/modules/audit/audit-hash.js';

export interface ChainedRowSpec {
  occurredAt: Date;
  action?: string;
  resourceId?: string;
}

/**
 * Insere registros encadeados direto no banco, com o horário escolhido (partições antigas, migração). Continua a cadeia
 * a partir de `prev` (o último hash da trilha) e devolve o novo último hash.
 */
export async function insertChainedRows(
  client: pg.Client,
  rows: ChainedRowSpec[],
  prev: Buffer = GENESIS_HASH,
): Promise<Buffer> {
  let last = prev;
  for (const spec of rows) {
    const row = {
      occurredAt: spec.occurredAt,
      actorType: ActorType.SYSTEM,
      actorUserId: null,
      action: spec.action ?? 'REPORT_VIEWED',
      resourceType: 'report',
      resourceId: spec.resourceId ?? null,
      result: AuditResult.SUCCESS,
      ip: null,
      userAgent: null,
      metadata: null,
    };
    const hash = computeAuditHash(last, row);
    await client.query(
      `INSERT INTO audit_logs (occurred_at, actor_type, action, resource_type, resource_id, result, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.occurredAt, row.actorType, row.action, row.resourceType, row.resourceId, row.result, last, hash],
    );
    last = hash;
  }
  return last;
}

/** Último hash da trilha, ou a gênese se ela estiver vazia. */
export async function lastHash(client: pg.Client): Promise<Buffer> {
  const { rows } = await client.query<{ hash: Buffer }>(`SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1`);
  return rows[0]?.hash ?? GENESIS_HASH;
}

/** Cria, como superusuário, uma partição mensal antiga com a mesma proteção que a função de manutenção aplica. */
export async function createOldPartition(superuser: pg.Client, year: number, month: number): Promise<string> {
  const name = `audit_logs_${year}_${String(month).padStart(2, '0')}`;
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  await superuser.query(`CREATE TABLE ${name} PARTITION OF audit_logs FOR VALUES FROM ('${from}') TO ('${next}')`);
  await superuser.query(`ALTER TABLE ${name} OWNER TO app_migrator`);
  await superuser.query(
    `CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON ${name} FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation()`,
  );
  await superuser.query(`REVOKE UPDATE, DELETE, TRUNCATE ON ${name} FROM app_runtime`);
  return name;
}
