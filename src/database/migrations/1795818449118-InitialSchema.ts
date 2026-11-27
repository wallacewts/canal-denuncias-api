import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por migration:generate e revisada: enums compartilhados (actor_type, report_status, report_outcome) eram criados mais de uma vez. */

export class InitialSchema1795818449118 implements MigrationInterface {
  name = 'InitialSchema1795818449118';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."role" AS ENUM('ADMIN', 'COMPLIANCE_MANAGER', 'ANALYST', 'DPO', 'AUDITOR')`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_roles" ("user_id" uuid NOT NULL, "role" "public"."role" NOT NULL, "granted_by_id" uuid, "granted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_09d115a69b6014d324d592f9c42" PRIMARY KEY ("user_id", "role"))`,
    );
    await queryRunner.query(`CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'BLOCKED', 'DISABLED')`);
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuidv7(), "name" character varying(120) NOT NULL, "email" citext NOT NULL, "password_hash" character varying NOT NULL, "mfa_secret_enc" bytea, "mfa_enabled_at" TIMESTAMP WITH TIME ZONE, "status" "public"."user_status" NOT NULL DEFAULT 'ACTIVE', "failed_login_count" integer NOT NULL DEFAULT '0', "locked_until" TIMESTAMP WITH TIME ZONE, "password_changed_at" TIMESTAMP WITH TIME ZONE, "last_login_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."report_status" AS ENUM('RECEIVED', 'IN_TRIAGE', 'UNDER_INVESTIGATION', 'AWAITING_REPORTER', 'CONCLUDED', 'INVALID', 'ARCHIVED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."report_outcome" AS ENUM('SUBSTANTIATED', 'PARTIALLY_SUBSTANTIATED', 'UNSUBSTANTIATED')`,
    );
    await queryRunner.query(`CREATE TYPE "public"."actor_type" AS ENUM('STAFF', 'REPORTER', 'SYSTEM')`);
    await queryRunner.query(
      `CREATE TABLE "report_status_history" ("id" uuid NOT NULL DEFAULT uuidv7(), "report_id" uuid NOT NULL, "from_status" "public"."report_status", "to_status" "public"."report_status" NOT NULL, "outcome" "public"."report_outcome", "actor_type" "public"."actor_type" NOT NULL, "actor_user_id" uuid, "justification_enc" bytea, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "status_history_actor_consistency" CHECK (("actor_type" = 'STAFF') = ("actor_user_id" IS NOT NULL)), CONSTRAINT "PK_e9ad2befdc991a63bc35bfe0390" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e42a2042aeabb5bc04ae1a4719" ON "report_status_history"  ("report_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuidv7(), "code" character varying(40) NOT NULL, "name" character varying(80) NOT NULL, "description" character varying(500), "active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', CONSTRAINT "UQ_77d7eff8a7aaa05457a12b8007a" UNIQUE ("code"), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "reporter_identities" ("report_id" uuid NOT NULL, "wrapped_dek" bytea NOT NULL, "payload_enc" bytea NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a54e200f14aeb3ba722700a13d4" PRIMARY KEY ("report_id"))`,
    );
    await queryRunner.query(`CREATE TYPE "public"."reporter_type" AS ENUM('EMPLOYEE', 'PARTNER', 'THIRD_PARTY')`);
    await queryRunner.query(`CREATE TYPE "public"."priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')`);
    await queryRunner.query(
      `CREATE TABLE "reports" ("id" uuid NOT NULL DEFAULT uuidv7(), "protocol" character varying(16) NOT NULL, "access_key_hash" character varying NOT NULL, "reporter_type" "public"."reporter_type" NOT NULL, "category_id" uuid NOT NULL, "status" "public"."report_status" NOT NULL DEFAULT 'RECEIVED', "outcome" "public"."report_outcome", "priority" "public"."priority", "has_identity" boolean NOT NULL DEFAULT false, "wrapped_dek" bytea, "content_enc" bytea, "assigned_to_id" uuid, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "due_at" TIMESTAMP WITH TIME ZONE, "closed_at" TIMESTAMP WITH TIME ZONE, "retention_until" TIMESTAMP WITH TIME ZONE, "shredded_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_1befeedef7c1ac398facbadeb8f" UNIQUE ("protocol"), CONSTRAINT "report_outcome_only_when_closed" CHECK ("outcome" IS NULL OR "status" IN ('CONCLUDED', 'ARCHIVED')), CONSTRAINT "PK_d9013193989303580053c0b5ef6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_e7f63c3c8dc26520d1db0a77fb" ON "reports"  ("retention_until") `);
    await queryRunner.query(`CREATE INDEX "IDX_23d2ada1e9df0834c42df8d0fb" ON "reports"  ("category_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_6334a373a2bb7a2f5f2d93ecaa" ON "reports"  ("status", "assigned_to_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT uuidv7(), "report_id" uuid NOT NULL, "author_type" "public"."actor_type" NOT NULL, "author_user_id" uuid, "body_enc" bytea NOT NULL, "read_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "message_author_consistency" CHECK (("author_type" = 'STAFF') = ("author_user_id" IS NOT NULL)), CONSTRAINT "message_author_type" CHECK ("author_type" IN ('REPORTER', 'STAFF')), CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1c8e5fb77c01096c7adc694e1" ON "messages"  ("report_id", "created_at") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."scan_status" AS ENUM('PENDING', 'CLEAN', 'INFECTED', 'FAILED')`);
    await queryRunner.query(
      `CREATE TABLE "attachments" ("id" uuid NOT NULL DEFAULT uuidv7(), "report_id" uuid NOT NULL, "message_id" uuid, "uploaded_by_type" "public"."actor_type" NOT NULL, "storage_key" character varying NOT NULL, "original_name_enc" bytea NOT NULL, "mime_type" character varying(100) NOT NULL, "size_bytes" integer NOT NULL, "ciphertext_hash" character varying(64) NOT NULL, "scan_status" "public"."scan_status" NOT NULL DEFAULT 'PENDING', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ec3648b85f6af7eafe865a3257b" UNIQUE ("storage_key"), CONSTRAINT "attachment_size_positive" CHECK ("size_bytes" > 0), CONSTRAINT "attachment_uploader_type" CHECK ("uploaded_by_type" IN ('REPORTER', 'STAFF')), CONSTRAINT "PK_5e1f050bcff31e3084a1d662412" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_00829c7ec94859cc964d6fff39" ON "attachments"  ("report_id") `);
    await queryRunner.query(`CREATE TYPE "public"."audit_result" AS ENUM('SUCCESS', 'DENIED', 'FAILURE')`);
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" BIGSERIAL NOT NULL, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actor_type" "public"."actor_type" NOT NULL, "actor_user_id" uuid, "action" character varying(60) NOT NULL, "resource_type" character varying(40) NOT NULL, "resource_id" character varying(64), "result" "public"."audit_result" NOT NULL, "ip" inet, "user_agent" character varying(255), "metadata" jsonb, "prev_hash" bytea NOT NULL, "hash" bytea NOT NULL, CONSTRAINT "UQ_67c4ff6334797c722a15eec21f1" UNIQUE ("hash"), CONSTRAINT "audit_ip_only_for_staff" CHECK ("actor_type" = 'STAFF' OR "ip" IS NULL), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_311fd3a4aaf703d43c5464ddfa" ON "audit_logs"  ("action", "occurred_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3d04b6f2b05825501c1427f0d9" ON "audit_logs"  ("resource_type", "resource_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e37764b66525bd2435a7b122d" ON "audit_logs"  ("actor_user_id", "occurred_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "recovery_codes" ("id" uuid NOT NULL DEFAULT uuidv7(), "user_id" uuid NOT NULL, "code_hash" character varying NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0723b9e53961e799027d7f7ba32" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_fb82b2ac740ca095b617afad03" ON "recovery_codes"  ("user_id") `);
    await queryRunner.query(
      `CREATE TABLE "sessions" ("id" uuid NOT NULL DEFAULT uuidv7(), "user_id" uuid NOT NULL, "refresh_token_hash" character varying NOT NULL, "family_id" uuid NOT NULL, "ip" inet, "user_agent" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_d6185b2849a1e4d0c067a57ca89" UNIQUE ("refresh_token_hash"), CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_f61929073858aa9cb9cb893b66" ON "sessions"  ("family_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_085d540d9f418cfbdc7bd55bb1" ON "sessions"  ("user_id") `);
    await queryRunner.query(
      `CREATE TABLE "internal_notes" ("id" uuid NOT NULL DEFAULT uuidv7(), "report_id" uuid NOT NULL, "author_id" uuid NOT NULL, "body_enc" bytea NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0e55e6e560cb954a17babf4ba1e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e6d4f2ddeea4cc6244b504e760" ON "internal_notes"  ("report_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "report_access_blocks" ("report_id" uuid NOT NULL, "user_id" uuid NOT NULL, "reason_enc" bytea, "created_by_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_35d0ae145bf4cf3eec17593d8a3" PRIMARY KEY ("report_id", "user_id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_61368d688e3491434d397ea93c" ON "report_access_blocks"  ("user_id") `);
    await queryRunner.query(
      `CREATE TABLE "report_assignments" ("id" uuid NOT NULL DEFAULT uuidv7(), "report_id" uuid NOT NULL, "user_id" uuid NOT NULL, "assigned_by_id" uuid NOT NULL, "assigned_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "released_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c4b7c8c7584df72048dd794ddbe" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_494f92177756e3b9dcb3b45c5f" ON "report_assignments"  ("user_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_d6c25da908fd5bbd58f2bc02b7" ON "report_assignments"  ("report_id") `);
    await queryRunner.query(
      `CREATE TABLE "settings" ("key" character varying(80) NOT NULL, "value" jsonb NOT NULL, "updated_by_id" uuid, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c8639b7626fa94ba8265628f214" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."reveal_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "identity_reveal_requests" ("id" uuid NOT NULL DEFAULT uuidv7(), "report_id" uuid NOT NULL, "requested_by_id" uuid NOT NULL, "justification_enc" bytea NOT NULL, "status" "public"."reveal_status" NOT NULL DEFAULT 'PENDING', "decided_by_id" uuid, "decided_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "reveal_four_eyes" CHECK ("decided_by_id" IS NULL OR "decided_by_id" <> "requested_by_id"), CONSTRAINT "PK_29af3b9aca2ee03588dde982fc5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34061c0d1123cfa2efaa821cf7" ON "identity_reveal_requests"  ("report_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ADD CONSTRAINT "FK_87b8888186ca9769c960e926870" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ADD CONSTRAINT "FK_ea5c1d658484d2e1e041d7f4ac1" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_status_history" ADD CONSTRAINT "FK_f6d35b6fc303f55b6af6fce3d52" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_status_history" ADD CONSTRAINT "FK_7bc37f46ed483231a1b7116ba97" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reporter_identities" ADD CONSTRAINT "FK_a54e200f14aeb3ba722700a13d4" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_23d2ada1e9df0834c42df8d0fb0" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_d65c5b4ef17354405b35979a71c" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_577884dd6b52590cc588c7d2ffc" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_9ff5ade37f97e224f67596ab6e0" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD CONSTRAINT "FK_00829c7ec94859cc964d6fff39c" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD CONSTRAINT "FK_623e10eec51ada466c5038979e3" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" ADD CONSTRAINT "FK_fb82b2ac740ca095b617afad031" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "internal_notes" ADD CONSTRAINT "FK_1af74d7c80296aa59b73844f435" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "internal_notes" ADD CONSTRAINT "FK_3d374c078a7c242bed3de038891" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_access_blocks" ADD CONSTRAINT "FK_802655b7907325675488754f165" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_access_blocks" ADD CONSTRAINT "FK_61368d688e3491434d397ea93c3" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_access_blocks" ADD CONSTRAINT "FK_eec6c23e1fecaee8b36fd623c55" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_assignments" ADD CONSTRAINT "FK_d6c25da908fd5bbd58f2bc02b79" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_assignments" ADD CONSTRAINT "FK_494f92177756e3b9dcb3b45c5f9" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_assignments" ADD CONSTRAINT "FK_b62ae616fcb764261afdd8b070d" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "identity_reveal_requests" ADD CONSTRAINT "FK_34061c0d1123cfa2efaa821cf73" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "identity_reveal_requests" ADD CONSTRAINT "FK_b42b272214b0ef1106dc89c1f35" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "identity_reveal_requests" ADD CONSTRAINT "FK_8579b6677fbd9a6027118305b2c" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "identity_reveal_requests" DROP CONSTRAINT "FK_8579b6677fbd9a6027118305b2c"`);
    await queryRunner.query(`ALTER TABLE "identity_reveal_requests" DROP CONSTRAINT "FK_b42b272214b0ef1106dc89c1f35"`);
    await queryRunner.query(`ALTER TABLE "identity_reveal_requests" DROP CONSTRAINT "FK_34061c0d1123cfa2efaa821cf73"`);
    await queryRunner.query(`ALTER TABLE "report_assignments" DROP CONSTRAINT "FK_b62ae616fcb764261afdd8b070d"`);
    await queryRunner.query(`ALTER TABLE "report_assignments" DROP CONSTRAINT "FK_494f92177756e3b9dcb3b45c5f9"`);
    await queryRunner.query(`ALTER TABLE "report_assignments" DROP CONSTRAINT "FK_d6c25da908fd5bbd58f2bc02b79"`);
    await queryRunner.query(`ALTER TABLE "report_access_blocks" DROP CONSTRAINT "FK_eec6c23e1fecaee8b36fd623c55"`);
    await queryRunner.query(`ALTER TABLE "report_access_blocks" DROP CONSTRAINT "FK_61368d688e3491434d397ea93c3"`);
    await queryRunner.query(`ALTER TABLE "report_access_blocks" DROP CONSTRAINT "FK_802655b7907325675488754f165"`);
    await queryRunner.query(`ALTER TABLE "internal_notes" DROP CONSTRAINT "FK_3d374c078a7c242bed3de038891"`);
    await queryRunner.query(`ALTER TABLE "internal_notes" DROP CONSTRAINT "FK_1af74d7c80296aa59b73844f435"`);
    await queryRunner.query(`ALTER TABLE "sessions" DROP CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19"`);
    await queryRunner.query(`ALTER TABLE "recovery_codes" DROP CONSTRAINT "FK_fb82b2ac740ca095b617afad031"`);
    await queryRunner.query(`ALTER TABLE "attachments" DROP CONSTRAINT "FK_623e10eec51ada466c5038979e3"`);
    await queryRunner.query(`ALTER TABLE "attachments" DROP CONSTRAINT "FK_00829c7ec94859cc964d6fff39c"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_9ff5ade37f97e224f67596ab6e0"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_577884dd6b52590cc588c7d2ffc"`);
    await queryRunner.query(`ALTER TABLE "reports" DROP CONSTRAINT "FK_d65c5b4ef17354405b35979a71c"`);
    await queryRunner.query(`ALTER TABLE "reports" DROP CONSTRAINT "FK_23d2ada1e9df0834c42df8d0fb0"`);
    await queryRunner.query(`ALTER TABLE "reporter_identities" DROP CONSTRAINT "FK_a54e200f14aeb3ba722700a13d4"`);
    await queryRunner.query(`ALTER TABLE "report_status_history" DROP CONSTRAINT "FK_7bc37f46ed483231a1b7116ba97"`);
    await queryRunner.query(`ALTER TABLE "report_status_history" DROP CONSTRAINT "FK_f6d35b6fc303f55b6af6fce3d52"`);
    await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "FK_ea5c1d658484d2e1e041d7f4ac1"`);
    await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "FK_87b8888186ca9769c960e926870"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_34061c0d1123cfa2efaa821cf7"`);
    await queryRunner.query(`DROP TABLE "identity_reveal_requests"`);
    await queryRunner.query(`DROP TABLE "settings"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d6c25da908fd5bbd58f2bc02b7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_494f92177756e3b9dcb3b45c5f"`);
    await queryRunner.query(`DROP TABLE "report_assignments"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_61368d688e3491434d397ea93c"`);
    await queryRunner.query(`DROP TABLE "report_access_blocks"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e6d4f2ddeea4cc6244b504e760"`);
    await queryRunner.query(`DROP TABLE "internal_notes"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_085d540d9f418cfbdc7bd55bb1"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f61929073858aa9cb9cb893b66"`);
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fb82b2ac740ca095b617afad03"`);
    await queryRunner.query(`DROP TABLE "recovery_codes"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8e37764b66525bd2435a7b122d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3d04b6f2b05825501c1427f0d9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_311fd3a4aaf703d43c5464ddfa"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_00829c7ec94859cc964d6fff39"`);
    await queryRunner.query(`DROP TABLE "attachments"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e1c8e5fb77c01096c7adc694e1"`);
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_6334a373a2bb7a2f5f2d93ecaa"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_23d2ada1e9df0834c42df8d0fb"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e7f63c3c8dc26520d1db0a77fb"`);
    await queryRunner.query(`DROP TABLE "reports"`);
    await queryRunner.query(`DROP TABLE "reporter_identities"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e42a2042aeabb5bc04ae1a4719"`);
    await queryRunner.query(`DROP TABLE "report_status_history"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "user_roles"`);
    await queryRunner.query(`DROP TYPE "public"."reveal_status"`);
    await queryRunner.query(`DROP TYPE "public"."audit_result"`);
    await queryRunner.query(`DROP TYPE "public"."scan_status"`);
    await queryRunner.query(`DROP TYPE "public"."priority"`);
    await queryRunner.query(`DROP TYPE "public"."reporter_type"`);
    await queryRunner.query(`DROP TYPE "public"."actor_type"`);
    await queryRunner.query(`DROP TYPE "public"."report_outcome"`);
    await queryRunner.query(`DROP TYPE "public"."report_status"`);
    await queryRunner.query(`DROP TYPE "public"."user_status"`);
    await queryRunner.query(`DROP TYPE "public"."role"`);
  }
}
