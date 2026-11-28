import { Check, Column, CreateDateColumn, Entity, OneToMany, UpdateDateColumn, type Relation } from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';
import { UserStatus } from '../../../common/enums/user-status.enum.js';
import { UserRole } from './user-role.entity.js';

/** Equipe interna. Usuários nunca são apagados fisicamente, só desativados (status DISABLED). */
@Entity('users')
@Check('CHK_users_mfa_enabled_secret', `"mfa_enabled_at" IS NULL OR "mfa_secret_enc" IS NOT NULL`)
@Check('CHK_users_lockout_level', `"lockout_level" BETWEEN 0 AND 16`)
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

  /** Segredo TOTP em cadastro ou em troca, selado como o `mfaSecretEnc`. */
  @Column({ type: 'bytea', nullable: true, select: false })
  mfaPendingSecretEnc: Buffer | null;

  /** Último passo de 30 s aceito (proteção contra replay do TOTP). */
  @Column({ type: 'bigint', nullable: true, select: false })
  mfaLastUsedStep: string | null;

  @Column({ type: 'enum', enum: UserStatus, enumName: 'user_status', default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: 'int', default: 0 })
  failedLoginCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  /** Nível do bloqueio progressivo: cada série de falhas dobra o tempo (feature 006). Zera na entrada completa. */
  @Column({ type: 'smallint', default: 0 })
  lockoutLevel: number;

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
