import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';
import { ActorType } from '../../../common/enums/actor-type.enum.js';
import { ReportOutcome } from '../../../common/enums/report-outcome.enum.js';
import { ReportStatus } from '../../../common/enums/report-status.enum.js';
import { Report } from '../../reports/entities/report.entity.js';
import { User } from '../../users/entities/user.entity.js';

@Entity('report_status_history')
@Index(['reportId', 'createdAt'])
@Check('status_history_actor_consistency', `("actor_type" = 'STAFF') = ("actor_user_id" IS NOT NULL)`)
export class ReportStatusHistory {
  @UuidV7PrimaryColumn()
  id: string;

  @Column({ type: 'uuid' })
  reportId: string;

  @Column({ type: 'enum', enum: ReportStatus, enumName: 'report_status', nullable: true })
  fromStatus: ReportStatus | null;

  @Column({ type: 'enum', enum: ReportStatus, enumName: 'report_status' })
  toStatus: ReportStatus;

  @Column({ type: 'enum', enum: ReportOutcome, enumName: 'report_outcome', nullable: true })
  outcome: ReportOutcome | null;

  @Column({ type: 'enum', enum: ActorType, enumName: 'actor_type' })
  actorType: ActorType;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'bytea', nullable: true })
  justificationEnc: Buffer | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Report, (r) => r.statusHistory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'report_id' })
  report: Relation<Report>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'actor_user_id' })
  actorUser: Relation<User> | null;
}
