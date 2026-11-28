import { Check, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Âncora de um expurgo da trilha (D51). Append-only; gravada só pela função `audit_purge_partition`, executável pelo
 * perfil de manutenção. A API só lê, para a verificação da cadeia.
 */
@Entity('audit_purges')
@Check('audit_purge_after_retention', `"purged_through" <= "purged_at" - interval '5 years'`)
@Check('audit_purge_rows_non_negative', `"rows_removed" >= 0`)
export class AuditPurge {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 63 })
  partitionName: string;

  /** Limite superior da partição removida. */
  @Column({ type: 'timestamptz' })
  purgedThrough: Date;

  @Column({ type: 'bigint' })
  rowsRemoved: string;

  /** Primeiro registro que restou: o novo início da cadeia. */
  @Column({ type: 'bigint', nullable: true })
  anchorAuditId: string | null;

  @Column({ type: 'bytea', nullable: true })
  anchorPrevHash: Buffer | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  purgedAt: Date;
}
