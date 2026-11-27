import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';
import { User } from '../../users/entities/user.entity.js';

/** Sessões da equipe interna (refresh token com rotação e detecção de reuso por família). */
@Entity('sessions')
@Index(['userId'])
@Index(['familyId'])
export class Session {
  @UuidV7PrimaryColumn()
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  /** sha256 do refresh token */
  @Column({ type: 'varchar', unique: true, select: false })
  refreshTokenHash: string;

  @Column({ type: 'uuid' })
  familyId: string;

  /** Só da equipe interna. Nunca há sessão de denunciante. */
  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt: Date;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
