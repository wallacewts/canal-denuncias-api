import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';
import { RevealStatus } from '../../../common/enums/reveal-status.enum.js';
import { Report } from '../../reports/entities/report.entity.js';
import { User } from '../../users/entities/user.entity.js';

/** Pedido de revelação de identidade. Quem aprova nunca é quem pediu (four-eyes, garantido no banco). */
@Entity('identity_reveal_requests')
@Index(['reportId'])
@Check('reveal_four_eyes', `"decided_by_id" IS NULL OR "decided_by_id" <> "requested_by_id"`)
export class IdentityRevealRequest {
  @UuidV7PrimaryColumn()
  id: string;

  @Column({ type: 'uuid' })
  reportId: string;

  @Column({ type: 'uuid' })
  requestedById: string;

  @Column({ type: 'bytea' })
  justificationEnc: Buffer;

  @Column({ type: 'enum', enum: RevealStatus, enumName: 'reveal_status', default: RevealStatus.PENDING })
  status: RevealStatus;

  @Column({ type: 'uuid', nullable: true })
  decidedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  /** Fim da janela de visualização. */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Report, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'report_id' })
  report: Relation<Report>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'requested_by_id' })
  requestedBy: Relation<User>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'decided_by_id' })
  decidedBy: Relation<User> | null;
}
