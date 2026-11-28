import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';
import { ActorType } from '../../common/enums/actor-type.enum.js';
import type { AuditResult } from '../../common/enums/audit-result.enum.js';
import { z } from 'zod';
import { AuditAction, AuditResourceType } from './audit-action.enum.js';
import { computeAuditHash, GENESIS_HASH } from './audit-hash.js';
import { AUDIT_RESOURCE_ID, toRejectionReasons, validateAuditMetadata } from './audit-metadata.schemas.js';
import { AuditEntryRejected } from './audit.errors.js';
import { AuditLog } from './entities/audit-log.entity.js';

/** Chave do advisory lock que serializa as gravações: sem ele, duas gravações leriam o mesmo último hash. */
const AUDIT_CHAIN_LOCK = 0x41_55_44_49; // "AUDI"

export interface AuditEntry {
  actorType: ActorType;
  actorUserId?: string | null;
  /** Do catálogo fechado (D45). */
  action: AuditAction;
  resourceType: AuditResourceType;
  /** Até 64 caracteres, só letras, dígitos e `_.:-`. */
  resourceId?: string | null;
  result: AuditResult;
  /** Só para ator STAFF. Para REPORTER e SYSTEM é descartado (constituição, princípio I). */
  ip?: string | null;
  userAgent?: string | null;
  /** Validada pelo schema da ação (`AUDIT_METADATA_SCHEMAS`): só IDs, códigos, números, datas e booleanos. */
  metadata?: Record<string, unknown> | null;
}

const entryShape = z.object({
  action: z.enum(AuditAction),
  resourceType: z.enum(AuditResourceType),
  resourceId: AUDIT_RESOURCE_ID.nullish(),
});

/**
 * Único jeito de escrever na trilha de auditoria (núcleo da AUDIT-02, trazido para a feature 001 pela D33).
 * Com `manager`, grava na transação do chamador: a operação e o registro confirmam ou desfazem juntos.
 */
@Injectable()
export class AuditService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async record(entry: AuditEntry, manager?: EntityManager): Promise<AuditLog> {
    // Validação antes de abrir transação ou pegar o lock: um registro recusado não toca no banco.
    const shape = entryShape.safeParse(entry);
    if (!shape.success) throw new AuditEntryRejected(toRejectionReasons(shape.error.issues));
    const metadata = validateAuditMetadata(entry.action, entry.metadata ?? undefined);
    const valid = { ...entry, metadata };
    return manager ? this.write(valid, manager) : this.dataSource.transaction((m) => this.write(valid, m));
  }

  private async write(entry: AuditEntry, manager: EntityManager): Promise<AuditLog> {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK]);
    const [last] = (await manager.query(`SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1`)) as Array<{
      hash: Buffer;
    }>;
    const prevHash = last?.hash ?? GENESIS_HASH;

    const isStaff = entry.actorType === ActorType.STAFF;
    const row = {
      // Definido pela aplicação antes do hash, para o hash bater com o valor salvo.
      occurredAt: new Date(),
      actorType: entry.actorType,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      result: entry.result,
      ip: isStaff ? (entry.ip ?? null) : null,
      userAgent: isStaff ? (entry.userAgent?.slice(0, 255) ?? null) : null,
      metadata: entry.metadata ?? null,
    };
    const hash = computeAuditHash(prevHash, row);

    // A metadata (jsonb) é um objeto livre, que o tipo do insert não descreve: o cast é só de tipo.
    const values = { ...row, prevHash, hash } as QueryDeepPartialEntity<AuditLog>;
    const inserted = await manager.insert(AuditLog, values);
    const id = String((inserted.identifiers[0] as { id: string | number }).id);
    return manager.findOneByOrFail(AuditLog, { id });
  }
}
