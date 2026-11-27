import type { MigrationInterface, QueryRunner } from 'typeorm';

/** citext: e-mail da equipe sem diferenciar maiúsculas. uuidv7() já é nativo no Postgres 18. */
export class Extensions1795000000000 implements MigrationInterface {
  name = 'Extensions1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS citext`);
  }
}
