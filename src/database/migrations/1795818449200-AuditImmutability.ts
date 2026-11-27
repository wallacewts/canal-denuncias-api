import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Torna audit_logs append-only:
 * - triggers bloqueiam UPDATE, DELETE e TRUNCATE para qualquer perfil (inclusive o dono da tabela);
 * - o perfil da API (app_runtime) perde UPDATE/DELETE/TRUNCATE na trilha e qualquer acesso à tabela de migrations.
 */
export class AuditImmutability1795818449200 implements MigrationInterface {
  name = 'AuditImmutability1795818449200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs é append-only (operação % bloqueada)', TG_OP;
      END $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_logs_immutable
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation()
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_logs_no_truncate
        BEFORE TRUNCATE ON audit_logs
        FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation()
    `);
    // O perfil app_runtime é criado pelo script de inicialização do banco (docker/postgres/01-roles.sh).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
          REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_runtime;
          REVOKE ALL ON typeorm_migrations FROM app_runtime;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS forbid_audit_mutation()`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
          GRANT UPDATE, DELETE ON audit_logs TO app_runtime;
        END IF;
      END $$
    `);
  }
}
