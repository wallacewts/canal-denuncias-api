import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { MfaStore, TotpRecord } from '@nestjs/authentication';
import type { DataSource } from 'typeorm';
import { AppSecretService } from '../../../modules/crypto/app-secret.service.js';
import { encryptionContext } from '../../../modules/crypto/encryption-context.js';

interface TotpRow {
  secret: Buffer | null;
  pending: Buffer | null;
  confirmed: boolean;
  last_step: string | null;
}

/**
 * Segundo fator no Postgres (definitivo, FR-023, `contracts/stores.md`). O pacote roda com `mfa.encryption: false`
 * e entrega o segredo base32 só para este store, que o sela com o `AppSecretService` (Vault, `app-kek`, preso ao
 * usuário) antes de gravar e o abre depois de ler: nenhuma chave fica fora do Vault (R1, princípio III). Toda chamada
 * ao Vault acontece fora de transação. As escritas que o contrato exige atômicas são uma instrução cada.
 */
@Injectable()
export class PgMfaStore implements MfaStore {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly secrets: AppSecretService,
  ) {}

  async getTotp(userId: string): Promise<TotpRecord | undefined> {
    const rows = (await this.ds.query(
      `SELECT mfa_secret_enc AS secret, mfa_pending_secret_enc AS pending,
              (mfa_enabled_at IS NOT NULL) AS confirmed, mfa_last_used_step::text AS last_step
       FROM users WHERE id = $1`,
      [userId],
    )) as TotpRow[];
    const row = rows[0];
    if (!row?.secret) return undefined;
    const record: TotpRecord = {
      secret: await this.open('users.mfa_secret_enc', userId, row.secret),
      confirmed: row.confirmed,
    };
    if (row.pending) record.pendingSecret = await this.open('users.mfa_pending_secret_enc', userId, row.pending);
    if (row.last_step !== null) record.lastUsedStep = Number(row.last_step);
    return record;
  }

  async saveTotp(userId: string, record: TotpRecord | null): Promise<void> {
    if (!record) {
      await this.ds.query(
        `UPDATE users SET mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL, mfa_enabled_at = NULL,
                mfa_last_used_step = NULL WHERE id = $1`,
        [userId],
      );
      return;
    }
    // Selagem antes da escrita: nada de Vault com transação aberta.
    const secret = await this.seal('users.mfa_secret_enc', userId, record.secret);
    const pending = record.pendingSecret
      ? await this.seal('users.mfa_pending_secret_enc', userId, record.pendingSecret)
      : null;
    await this.ds.query(
      `UPDATE users SET
         mfa_secret_enc = $2,
         mfa_pending_secret_enc = $3,
         mfa_enabled_at = CASE WHEN $4::boolean THEN COALESCE(mfa_enabled_at, now()) ELSE NULL END,
         mfa_last_used_step = GREATEST(mfa_last_used_step, $5::bigint)
       WHERE id = $1`,
      [userId, secret, pending, record.confirmed, record.lastUsedStep ?? null],
    );
  }

  async claimTotpStep(userId: string, step: number): Promise<boolean> {
    const result = (await this.ds.query(
      `UPDATE users SET mfa_last_used_step = $2
       WHERE id = $1 AND mfa_secret_enc IS NOT NULL AND (mfa_last_used_step IS NULL OR mfa_last_used_step < $2)`,
      [userId, step],
    )) as [unknown[], number];
    return result[1] > 0;
  }

  async saveRecoveryCodes(userId: string, hashes: string[]): Promise<void> {
    await this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM recovery_codes WHERE user_id = $1`, [userId]);
      if (hashes.length > 0) {
        await m.query(`INSERT INTO recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])`, [
          userId,
          hashes,
        ]);
      }
    });
  }

  async consumeRecoveryCode(userId: string, hash: string): Promise<boolean> {
    const rows = (await this.ds.query(`DELETE FROM recovery_codes WHERE user_id = $1 AND code_hash = $2 RETURNING id`, [
      userId,
      hash,
    ])) as [unknown[], number];
    return rows[1] > 0;
  }

  async countRecoveryCodes(userId: string): Promise<number> {
    const rows = (await this.ds.query(`SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1`, [
      userId,
    ])) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  async recordMfaFailure(userId: string, windowMs: number, now: number): Promise<number> {
    // Grava e conta em instruções separadas, cada uma visível às outras chamadas ao terminar (regra do contrato).
    await this.ds.query(`INSERT INTO mfa_failures (user_id, failed_at) VALUES ($1, $2)`, [userId, new Date(now)]);
    return this.countMfaFailures(userId, windowMs, now);
  }

  async countMfaFailures(userId: string, windowMs: number, now: number): Promise<number> {
    const rows = (await this.ds.query(
      // Só o limite inferior (`at > now - windowMs`), como o contrato define: um limite superior faria chamadas
      // paralelas com relógios ligeiramente diferentes deixarem de contar umas às outras.
      `SELECT count(*)::int AS n FROM mfa_failures WHERE user_id = $1 AND failed_at > $2`,
      [userId, new Date(now - windowMs)],
    )) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  async clearMfaFailures(userId: string): Promise<void> {
    await this.ds.query(`DELETE FROM mfa_failures WHERE user_id = $1`, [userId]);
  }

  private async seal(field: 'users.mfa_secret_enc' | 'users.mfa_pending_secret_enc', userId: string, value: string) {
    const sealed = await this.secrets.seal(encryptionContext(field, userId), Buffer.from(value, 'utf8'));
    return Buffer.from(sealed, 'utf8');
  }

  private async open(field: 'users.mfa_secret_enc' | 'users.mfa_pending_secret_enc', userId: string, value: Buffer) {
    const plain = await this.secrets.open(encryptionContext(field, userId), value.toString('utf8'));
    try {
      return plain.toString('utf8');
    } finally {
      plain.fill(0);
    }
  }
}
