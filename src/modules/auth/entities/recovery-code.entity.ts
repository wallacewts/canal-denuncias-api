import { Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';
import { User } from '../../users/entities/user.entity.js';

/** Códigos de recuperação do MFA, exibidos uma única vez e guardados como hash. */
@Entity('recovery_codes')
@Index(['userId'])
export class RecoveryCode {
  @UuidV7PrimaryColumn()
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  /** argon2id */
  @Column({ type: 'varchar', select: false })
  codeHash: string;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
