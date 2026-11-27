import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';
import { Report } from '../../reports/entities/report.entity.js';
import { User } from '../../users/entities/user.entity.js';

/** Histórico de atribuições. O responsável atual fica em `reports.assigned_to_id`. */
@Entity('report_assignments')
@Index(['reportId'])
@Index(['userId'])
export class ReportAssignment {
  @UuidV7PrimaryColumn()
  id: string;

  @Column({ type: 'uuid' })
  reportId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid' })
  assignedById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  assignedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  releasedAt: Date | null;

  @ManyToOne(() => Report, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'report_id' })
  report: Relation<Report>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'assigned_by_id' })
  assignedBy: Relation<User>;
}
