import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores definitivos de autenticação (feature 004, D53, data-model.md): `sessions` no formato do `SessionStore` do
 * `@nestjs/authentication` (chave = hash do cookie, sem renovação por tokens), colunas de MFA em `users`,
 * `recovery_codes` com consumo por DELETE e `mfa_failures`. As tabelas estão vazias (nenhum login existiu): não há
 * dados a migrar. O `down()` restaura o formato da InitialSchema.
 */
export class AuthStores1795900000000 implements MigrationInterface {
  name = 'AuthStores1795900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "sessions"`);
    await q.query(`CREATE TYPE "public"."session_mfa_state" AS ENUM('pending', 'verified')`);
    await q.query(`
      CREATE TABLE "sessions" (
        "id" character varying(64) NOT NULL,
        "user_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "last_active_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "mfa" "public"."session_mfa_state",
        "metadata" jsonb,
        CONSTRAINT "PK_sessions_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_sessions_expiry" CHECK ("expires_at" > "created_at"),
        CONSTRAINT "FK_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`);
    await q.query(`CREATE INDEX "IDX_sessions_user_id" ON "sessions" ("user_id")`);
    await q.query(`CREATE INDEX "IDX_sessions_expires_at" ON "sessions" ("expires_at")`);

    await q.query(`ALTER TABLE "users" ADD "mfa_pending_secret_enc" bytea`);
    await q.query(`ALTER TABLE "users" ADD "mfa_last_used_step" bigint`);
    await q.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_mfa_enabled_secret" CHECK ("mfa_enabled_at" IS NULL OR "mfa_secret_enc" IS NOT NULL)`,
    );

    await q.query(`ALTER TABLE "recovery_codes" DROP COLUMN "used_at"`);
    await q.query(
      `ALTER TABLE "recovery_codes" ADD CONSTRAINT "UQ_recovery_codes_user_hash" UNIQUE ("user_id", "code_hash")`,
    );

    await q.query(`
      CREATE TABLE "mfa_failures" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "user_id" uuid NOT NULL,
        "failed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_mfa_failures_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_mfa_failures_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`);
    await q.query(`CREATE INDEX "IDX_mfa_failures_user_failed_at" ON "mfa_failures" ("user_id", "failed_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "mfa_failures"`);
    await q.query(`ALTER TABLE "recovery_codes" DROP CONSTRAINT "UQ_recovery_codes_user_hash"`);
    await q.query(`ALTER TABLE "recovery_codes" ADD "used_at" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_mfa_enabled_secret"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "mfa_last_used_step"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "mfa_pending_secret_enc"`);

    await q.query(`DROP TABLE "sessions"`);
    await q.query(`DROP TYPE "public"."session_mfa_state"`);
    await q.query(
      `CREATE TABLE "sessions" ("id" uuid NOT NULL DEFAULT uuidv7(), "user_id" uuid NOT NULL, "refresh_token_hash" character varying NOT NULL, "family_id" uuid NOT NULL, "ip" inet, "user_agent" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_d6185b2849a1e4d0c067a57ca89" UNIQUE ("refresh_token_hash"), CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`,
    );
    await q.query(`CREATE INDEX "IDX_f61929073858aa9cb9cb893b66" ON "sessions"  ("family_id") `);
    await q.query(`CREATE INDEX "IDX_085d540d9f418cfbdc7bd55bb1" ON "sessions"  ("user_id") `);
    await q.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
