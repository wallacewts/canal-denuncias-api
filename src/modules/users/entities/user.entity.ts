import { Column, CreateDateColumn, Entity, OneToMany, UpdateDateColumn, type Relation } from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';
import { UserStatus } from '../../../common/enums/user-status.enum.js';
import { UserRole } from './user-role.entity.js';

/** Equipe interna. Usuários nunca são apagados fisicamente, só desativados (status DISABLED). */
@Entity('users')
export class User {
  @UuidV7PrimaryColumn()
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'citext', unique: true })
  email: string;

  /** argon2id */
  @Column({ type: 'varchar', select: false })
  passwordHash: string;

  /** Segredo TOTP cifrado no Vault (app-kek). */
  @Column({ type: 'bytea', nullable: true, select: false })
  mfaSecretEnc: Buffer | null;

  @Column({ type: 'timestamptz', nullable: true })
  mfaEnabledAt: Date | null;

  @Column({ type: 'enum', enum: UserStatus, enumName: 'user_status', default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: 'int', default: 0 })
  failedLoginCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  passwordChangedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => UserRole, (r) => r.user, { cascade: ['insert'] })
  roles: Relation<UserRole[]>;
}
