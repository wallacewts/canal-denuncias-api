import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { SessionRecord, SessionStore } from '@nestjs/authentication';
import type { DataSource } from 'typeorm';
import type { Role } from '../../../common/enums/role.enum.js';
import type { UserStatus } from '../../../common/enums/user-status.enum.js';
import '../staff-user.js';

interface SessionRow {
  id: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
  last_active_at: Date;
  mfa: 'pending' | 'verified' | null;
  metadata: Record<string, unknown> | null;
}

/** Linha → `SessionRecord`: campos opcionais ausentes (nunca `null`), como o contrato exige. */
function toRecord(row: SessionRow): SessionRecord {
  const record: SessionRecord = {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastActiveAt: row.last_active_at,
  };
  if (row.mfa) record.mfa = row.mfa;
  if (row.metadata) record.metadata = row.metadata;
  return record;
}

/**
 * Sessões no Postgres (definitivo, FR-023, `contracts/stores.md`). Cada método é uma instrução: a atividade só avança
 * e nunca recria sessão apagada; apagar devolve se esta chamada apagou. A leitura traz o usuário e os perfis na mesma
 * consulta (`extra`), para o provider recarregar a identidade sem outra ida ao banco.
 */
@Injectable()
export class PgSessionStore implements SessionStore {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const rows = (await this.ds.query(
      `SELECT s.*, u.status AS user_status,
              COALESCE(array_agg(r.role::text) FILTER (WHERE r.role IS NOT NULL), '{}') AS user_roles
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_roles r ON r.user_id = s.user_id
       WHERE s.id = $1
       GROUP BY s.id, u.status`,
      [id],
    )) as Array<SessionRow & { user_status: UserStatus; user_roles: Role[] }>;
    const row = rows[0];
    if (!row) return undefined;
    return { ...toRecord(row), extra: { user: { id: row.user_id, roles: row.user_roles, status: row.user_status } } };
  }

  async createSession(record: SessionRecord): Promise<void> {
    // Aproveita para apagar as expiradas do usuário, para a tabela não crescer sem limite.
    await this.ds.query(`DELETE FROM sessions WHERE user_id = $1 AND expires_at <= $2`, [
      record.userId,
      record.createdAt,
    ]);
    await this.ds.query(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, last_active_at, mfa, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        record.id,
        record.userId,
        record.createdAt,
        record.expiresAt,
        record.lastActiveAt,
        record.mfa ?? null,
        record.metadata ? JSON.stringify(record.metadata) : null,
      ],
    );
  }

  async touchSession(id: string, lastActiveAt: Date): Promise<void> {
    await this.ds.query(`UPDATE sessions SET last_active_at = $2 WHERE id = $1 AND last_active_at < $2`, [
      id,
      lastActiveAt,
    ]);
  }

  async deleteSession(id: string): Promise<boolean> {
    const result = (await this.ds.query(`DELETE FROM sessions WHERE id = $1`, [id])) as [unknown[], number];
    return result[1] > 0;
  }

  async listUserSessions(userId: string): Promise<SessionRecord[]> {
    const rows = (await this.ds.query(`SELECT * FROM sessions WHERE user_id = $1`, [userId])) as SessionRow[];
    return rows.map(toRecord);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.ds.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  }
}
