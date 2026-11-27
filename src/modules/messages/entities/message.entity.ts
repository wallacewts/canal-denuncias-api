import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  type Relation,
} from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';
import { ActorType } from '../../../common/enums/actor-type.enum.js';
import { Attachment } from '../../attachments/entities/attachment.entity.js';
import { Report } from '../../reports/entities/report.entity.js';
import { User } from '../../users/entities/user.entity.js';

/** Conversa entre denunciante e equipe. Para o denunciante, a equipe aparece só como "Equipe de apuração". */
@Entity('messages')
@Index(['reportId', 'createdAt'])
@Check('message_author_type', `"author_type" IN ('REPORTER', 'STAFF')`)
@Check('message_author_consistency', `("author_type" = 'STAFF') = ("author_user_id" IS NOT NULL)`)
export class Message {
  @UuidV7PrimaryColumn()
  id: string;

  @Column({ type: 'uuid' })
  reportId: string;

  @Column({ type: 'enum', enum: ActorType, enumName: 'actor_type' })
  authorType: ActorType;

  @Column({ type: 'uuid', nullable: true })
  authorUserId: string | null;

  @Column({ type: 'bytea' })
  bodyEnc: Buffer;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Report, (r) => r.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'report_id' })
  report: Relation<Report>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'author_user_id' })
  authorUser: Relation<User> | null;

  @OneToMany(() => Attachment, (a) => a.message)
  attachments: Relation<Attachment[]>;
}
