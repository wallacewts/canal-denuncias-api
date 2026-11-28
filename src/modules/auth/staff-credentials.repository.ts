import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import type { UserStatus } from '../../common/enums/user-status.enum.js';
import type { LockoutConfig } from './lockout.js';

export interface StaffCredentials {
  id: string;
  passwordHash: string;
  status: UserStatus;
  lockedUntil: Date | null;
}

/**
 * Leituras e contadores do login (feature 006, R3). Único lugar do módulo de auth que lê `password_hash`, além do
 * `UsersRepository.findCredentialsByEmail` da feature 001. Contadores sempre numa instrução atômica.
 */
@Injectable()
export class StaffCredentialsRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async findByEmail(email: string): Promise<StaffCredentials | null> {
    const rows = (await this.ds.query(
      `SELECT id::text AS id, password_hash, status::text AS status, locked_until FROM users WHERE email = $1`,
      [email],
    )) as Array<{ id: string; password_hash: string; status: UserStatus; locked_until: Date | null }>;
    const row = rows[0];
    return row
      ? { id: row.id, passwordHash: row.password_hash, status: row.status, lockedUntil: row.locked_until }
      : null;
  }

  async isLocked(userId: string, now: Date): Promise<boolean> {
    const rows = (await this.ds.query(`SELECT locked_until > $2 AS locked FROM users WHERE id = $1`, [
      userId,
      now,
    ])) as Array<{
      locked: boolean | null;
    }>;
    return Boolean(rows[0]?.locked);
  }

  async passwordChangeRequired(userId: string): Promise<boolean> {
    const rows = (await this.ds.query(`SELECT password_changed_at IS NULL AS required FROM users WHERE id = $1`, [
      userId,
    ])) as Array<{ required: boolean }>;
    return Boolean(rows[0]?.required);
  }

  /**
   * Conta uma falha e, no limiar, bloqueia por base × 2^nível (teto) e sobe o nível, tudo numa instrução. Conta já
   * bloqueada não conta: a condição é reavaliada sobre a linha atual quando falhas simultâneas esperam a trava.
   */
  async registerFailure(
    userId: string,
    config: LockoutConfig,
    now: Date,
    manager: EntityManager = this.ds.manager,
  ): Promise<{ locked: boolean } | null> {
    const rows = (await manager.query(
      `UPDATE users SET
         failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
         locked_until = CASE WHEN failed_login_count + 1 >= $2
           THEN $5::timestamptz + LEAST($3 * power(2, lockout_level), $4) * interval '1 minute'
           ELSE locked_until END,
         lockout_level = CASE WHEN failed_login_count + 1 >= $2 THEN LEAST(lockout_level + 1, 16) ELSE lockout_level END
       WHERE id = $1 AND (locked_until IS NULL OR locked_until <= $5)
       RETURNING locked_until > $5 AS locked`,
      [userId, config.threshold, config.base, config.max, now],
    )) as [Array<{ locked: boolean }>, number];
    const row = rows[0]?.[0];
    return row ? { locked: Boolean(row.locked) } : null;
  }

  /** Entrada completa: zera contador, nível e bloqueio. */
  async resetFailures(userId: string): Promise<void> {
    await this.ds.query(
      `UPDATE users SET failed_login_count = 0, lockout_level = 0, locked_until = NULL
        WHERE id = $1 AND (failed_login_count <> 0 OR lockout_level <> 0 OR locked_until IS NOT NULL)`,
      [userId],
    );
  }

  async updatePasswordHash(userId: string, hash: string): Promise<void> {
    await this.ds.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, hash]);
  }
}
