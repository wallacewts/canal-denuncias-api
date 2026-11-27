import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { Report } from '../../reports/entities/report.entity.js';
import { User } from '../../users/entities/user.entity.js';

/**
 * Conflito de interesse: usuário impedido de acessar a denúncia.
 * Marcado manualmente na triagem, porque os envolvidos ficam cifrados.
 */
@Entity('report_access_blocks')
@Index(['userId'])
export class ReportAccessBlock {
  @PrimaryColumn({ type: 'uuid' })
  reportId: string;

  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @Column({ type: 'bytea', nullable: true })
  reasonEnc: Buffer | null;

  @Column({ type: 'uuid' })
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Report, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'report_id' })
  report: Relation<Report>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by_id' })
  createdBy: Relation<User>;
}
