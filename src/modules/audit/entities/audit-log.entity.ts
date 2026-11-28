import { Check, Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { ActorType } from '../../../common/enums/actor-type.enum.js';
import { AuditResult } from '../../../common/enums/audit-result.enum.js';

/**
 * Trilha de auditoria append-only com cadeia de hash.
 * Sem FKs de propósito: a trilha precisa sobreviver a qualquer outra mudança no banco.
 * `metadata` nunca contém dado pessoal nem conteúdo de denúncia, só IDs e códigos.
 * UPDATE/DELETE/TRUNCATE são bloqueados por permissão e por trigger (migrations AuditImmutability e
 * AuditLogPartitioning). A tabela é particionada por mês em `occurred_at` (D48): por isso a chave primária é
 * `(id, occurred_at)` e o `hash` não tem restrição única (o Postgres exige a chave de partição em toda unicidade).
 */
@Entity('audit_logs')
@Index(['actorUserId', 'occurredAt'])
@Index(['resourceType', 'resourceId'])
@Index(['action', 'occurredAt'])
@Check('audit_ip_only_for_staff', `"actor_type" = 'STAFF' OR "ip" IS NULL`)
export class AuditLog {
  /** O driver pg devolve bigint como string. */
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  /** Definido pela aplicação antes do hash. Chave de partição. */
  @PrimaryColumn({ type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  @Column({ type: 'enum', enum: ActorType, enumName: 'actor_type' })
  actorType: ActorType;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  /** REPORT_VIEWED, IDENTITY_REVEALED, REPORT_SHREDDED... */
  @Column({ type: 'varchar', length: 60 })
  action: string;

  @Column({ type: 'varchar', length: 40 })
  resourceType: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  resourceId: string | null;

  @Column({ type: 'enum', enum: AuditResult, enumName: 'audit_result' })
  result: AuditResult;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'bytea' })
  prevHash: Buffer;

  @Column({ type: 'bytea' })
  hash: Buffer;
}
