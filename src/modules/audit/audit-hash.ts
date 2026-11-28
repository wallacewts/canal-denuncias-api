import { createHash } from 'node:crypto';
import type { ActorType } from '../../common/enums/actor-type.enum.js';
import type { AuditResult } from '../../common/enums/audit-result.enum.js';

/** `prev_hash` do primeiro registro da trilha. */
export const GENESIS_HASH: Buffer = Buffer.alloc(32);

/** Campos de um registro que entram no hash. Qualquer alteração em um deles quebra a cadeia. */
export interface AuditHashInput {
  occurredAt: Date;
  actorType: ActorType;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: AuditResult;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * `hash = sha256(prev_hash ‖ JSON canônico dos campos)`. A metadata é serializada com as chaves em ordem, para o hash
 * ser reproduzível na verificação da cadeia (AUDIT-07). IP e user-agent também entram, para que não possam ser
 * trocados sem quebrar a cadeia.
 */
export function computeAuditHash(prevHash: Buffer, entry: AuditHashInput): Buffer {
  const fields = [
    entry.occurredAt.toISOString(),
    entry.actorType,
    entry.actorUserId ?? null,
    entry.action,
    entry.resourceType,
    entry.resourceId ?? null,
    entry.result,
    entry.ip ?? null,
    entry.userAgent ?? null,
    canonical(entry.metadata ?? null),
  ];
  return createHash('sha256').update(prevHash).update(JSON.stringify(fields), 'utf8').digest();
}
