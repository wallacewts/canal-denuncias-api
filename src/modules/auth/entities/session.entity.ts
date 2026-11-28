import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';

/**
 * Sessão da equipe interna no formato do `SessionStore` do `@nestjs/authentication` (D53). A chave é o SHA-256 do
 * token do cookie (o token nunca é guardado). Sem renovação por tokens: revogar é apagar a linha.
 */
@Entity('sessions')
@Index('IDX_sessions_user_id', ['userId'])
@Index('IDX_sessions_expires_at', ['expiresAt'])
@Check('CHK_sessions_expiry', `"expires_at" > "created_at"`)
@Check('CHK_sessions_password_change_failures', `"password_change_failures" BETWEEN 0 AND 5`)
export class Session {
  @PrimaryColumn({ type: 'varchar', length: 64, primaryKeyConstraintName: 'PK_sessions_id' })
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'timestamptz' })
  createdAt: Date;

  /** Expiração absoluta (8 h): a atividade nunca a estende. */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Última atividade, para a expiração por inatividade (15 min). Só avança. */
  @Column({ type: 'timestamptz' })
  lastActiveAt: Date;

  @Column({ type: 'enum', enum: ['pending', 'verified'], enumName: 'session_mfa_state', nullable: true })
  mfa: 'pending' | 'verified' | null;

  /** Só `{ ip, userAgent }` da equipe interna. */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  /** Erros de senha atual na troca de senha desta sessão; no 5º a sessão é encerrada (feature 006). */
  @Column({ type: 'smallint', default: 0 })
  passwordChangeFailures: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_sessions_user' })
  user: Relation<User>;
}
