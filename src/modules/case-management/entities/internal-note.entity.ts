import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';
import { Report } from '../../reports/entities/report.entity.js';
import { User } from '../../users/entities/user.entity.js';

/** Nota interna da equipe. Nunca visível ao denunciante. */
@Entity('internal_notes')
@Index(['reportId', 'createdAt'])
export class InternalNote {
  @UuidV7PrimaryColumn()
  id: string;

  @Column({ type: 'uuid' })
  reportId: string;

  @Column({ type: 'uuid' })
  authorId: string;

  @Column({ type: 'bytea' })
  bodyEnc: Buffer;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Report, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'report_id' })
  report: Relation<Report>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'author_id' })
  author: Relation<User>;
}
