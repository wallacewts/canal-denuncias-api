import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';

/** Falhas de segundo fator, para o bloqueio por tentativas do `MfaService` (contadas numa janela). */
@Entity('mfa_failures')
@Index('IDX_mfa_failures_user_failed_at', ['userId', 'failedAt'])
export class MfaFailure {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'PK_mfa_failures_id',
  })
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'timestamptz' })
  failedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_mfa_failures_user' })
  user: Relation<User>;
}
