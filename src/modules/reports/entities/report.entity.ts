import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';
import { Priority } from '../../../common/enums/priority.enum.js';
import { ReportOutcome } from '../../../common/enums/report-outcome.enum.js';
import { ReportStatus } from '../../../common/enums/report-status.enum.js';
import { ReporterType } from '../../../common/enums/reporter-type.enum.js';
import { Attachment } from '../../attachments/entities/attachment.entity.js';
import { ReportStatusHistory } from '../../case-management/entities/report-status-history.entity.js';
import { Category } from '../../catalog/entities/category.entity.js';
import { ReporterIdentity } from '../../identity-vault/entities/reporter-identity.entity.js';
import { Message } from '../../messages/entities/message.entity.js';
import { User } from '../../users/entities/user.entity.js';

/**
 * Denúncia. Em claro fica só o que alimenta filtro, SLA ou estatística.
 * O relato inteiro vai cifrado em `contentEnc` (JSON no formato ReportContentV1).
 */
@Entity('reports')
@Index(['status', 'assignedToId'])
@Index(['categoryId'])
@Index(['retentionUntil'])
@Check('report_outcome_only_when_closed', `"outcome" IS NULL OR "status" IN ('CONCLUDED', 'ARCHIVED')`)
export class Report {
  @UuidV7PrimaryColumn()
  id: string;

  /** Aleatório, base32 Crockford. Nunca sequencial. */
  @Column({ type: 'varchar', length: 16, unique: true })
  protocol: string;

  /** argon2id da chave entregue ao denunciante. */
  @Column({ type: 'varchar', select: false })
  accessKeyHash: string;

  @Column({ type: 'enum', enum: ReporterType, enumName: 'reporter_type' })
  reporterType: ReporterType;

  @Column({ type: 'uuid' })
  categoryId: string;

  @Column({ type: 'enum', enum: ReportStatus, enumName: 'report_status', default: ReportStatus.RECEIVED })
  status: ReportStatus;

  @Column({ type: 'enum', enum: ReportOutcome, enumName: 'report_outcome', nullable: true })
  outcome: ReportOutcome | null;

  @Column({ type: 'enum', enum: Priority, enumName: 'priority', nullable: true })
  priority: Priority | null;

  @Column({ type: 'boolean', default: false })
  hasIdentity: boolean;

  /** DEK cifrada pelo Vault (report-kek). null = expurgada (crypto-shredding). */
  @Column({ type: 'bytea', nullable: true, select: false })
  wrappedDek: Buffer | null;

  /** JSON do relato cifrado com AES-256-GCM. */
  @Column({ type: 'bytea', nullable: true, select: false })
  contentEnc: Buffer | null;

  @Column({ type: 'uuid', nullable: true })
  assignedToId: string | null;

  /** Exato no banco (SLA). O denunciante e as exportações veem só a data. */
  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  retentionUntil: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  shreddedAt: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Category)
  @JoinColumn({ name: 'category_id' })
  category: Relation<Category>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'assigned_to_id' })
  assignedTo: Relation<User> | null;

  @OneToOne(() => ReporterIdentity, (i) => i.report)
  identity: Relation<ReporterIdentity> | null;

  @OneToMany(() => ReportStatusHistory, (h) => h.report)
  statusHistory: Relation<ReportStatusHistory[]>;

  @OneToMany(() => Message, (m) => m.report)
  messages: Relation<Message[]>;

  @OneToMany(() => Attachment, (a) => a.report)
  attachments: Relation<Attachment[]>;
}
