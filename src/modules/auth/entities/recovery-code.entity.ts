import { Column, Entity, Index, JoinColumn, ManyToOne, Unique, type Relation } from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';
import { User } from '../../users/entities/user.entity.js';

/** Códigos de recuperação do MFA, exibidos uma única vez e guardados como hash. Usar = apagar a linha. */
@Entity('recovery_codes')
@Index(['userId'])
@Unique('UQ_recovery_codes_user_hash', ['userId', 'codeHash'])
export class RecoveryCode {
  @UuidV7PrimaryColumn()
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  /** Hash lento do `@nestjs/authentication`, salgado com o usuário. */
  @Column({ type: 'varchar', select: false })
  codeHash: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
