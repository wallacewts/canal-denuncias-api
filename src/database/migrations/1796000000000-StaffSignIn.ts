import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Login da equipe (feature 006, data-model.md): nível do bloqueio progressivo em `users` (dobra o tempo a cada série)
 * e contador de erros de senha atual na troca de senha, preso à própria sessão. Colunas com padrão 0: nenhuma linha
 * existente precisa de dado novo.
 */
export class StaffSignIn1796000000000 implements MigrationInterface {
  name = 'StaffSignIn1796000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" ADD "lockout_level" smallint NOT NULL DEFAULT 0`);
    await q.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_lockout_level" CHECK ("lockout_level" BETWEEN 0 AND 16)`,
    );
    await q.query(`ALTER TABLE "sessions" ADD "password_change_failures" smallint NOT NULL DEFAULT 0`);
    await q.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "CHK_sessions_password_change_failures" CHECK ("password_change_failures" BETWEEN 0 AND 5)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "sessions" DROP CONSTRAINT "CHK_sessions_password_change_failures"`);
    await q.query(`ALTER TABLE "sessions" DROP COLUMN "password_change_failures"`);
    await q.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_lockout_level"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "lockout_level"`);
  }
}
