import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Trilha de auditoria particionada por mês, com expurgo de 5 anos (feature 003, R7 a R12, D48 a D51).
 * Escrita à mão: o TypeORM não cria tabela particionada nem funções. Nomes de índices e restrições iguais aos que o
 * TypeORM geraria, para a checagem de divergência continuar sem diferenças.
 */

const COLUMNS = `id, occurred_at, actor_type, actor_user_id, action, resource_type, resource_id, result, ip, user_agent,
  metadata, prev_hash, hash`;

const COLUMN_DEFS = `"id" bigint NOT NULL DEFAULT nextval('audit_logs_id_seq'::regclass),
  "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "actor_type" "public"."actor_type" NOT NULL,
  "actor_user_id" uuid,
  "action" character varying(60) NOT NULL,
  "resource_type" character varying(40) NOT NULL,
  "resource_id" character varying(64),
  "result" "public"."audit_result" NOT NULL,
  "ip" inet,
  "user_agent" character varying(255),
  "metadata" jsonb,
  "prev_hash" bytea NOT NULL,
  "hash" bytea NOT NULL,
  CONSTRAINT "audit_ip_only_for_staff" CHECK ("actor_type" = 'STAFF' OR "ip" IS NULL)`;

const INDEXES = [
  `CREATE INDEX "IDX_311fd3a4aaf703d43c5464ddfa" ON "audit_logs" ("action", "occurred_at")`,
  `CREATE INDEX "IDX_3d04b6f2b05825501c1427f0d9" ON "audit_logs" ("resource_type", "resource_id")`,
  `CREATE INDEX "IDX_8e37764b66525bd2435a7b122d" ON "audit_logs" ("actor_user_id", "occurred_at")`,
];

const IMMUTABILITY = [
  `CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
     FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation()`,
  `CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
     FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation()`,
];

/** Igual à conferência da migração: aborta se a cópia não tiver as mesmas linhas, o mesmo maior id e o mesmo último hash. */
const CHECK_COPY = (from: string, to: string) => `
  DO $$
  DECLARE
    a bigint; b bigint; ida bigint; idb bigint; ha bytea; hb bytea;
  BEGIN
    SELECT count(*), max(id) INTO a, ida FROM ${from};
    SELECT count(*), max(id) INTO b, idb FROM ${to};
    SELECT hash INTO ha FROM ${from} ORDER BY id DESC LIMIT 1;
    SELECT hash INTO hb FROM ${to} ORDER BY id DESC LIMIT 1;
    IF a <> b OR ida IS DISTINCT FROM idb OR ha IS DISTINCT FROM hb THEN
      RAISE EXCEPTION 'Migração da trilha abortada: a cópia não confere com a origem.';
    END IF;
  END $$`;

const IF_ROLE = (role: string, sql: string) => `
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
      ${sql}
    END IF;
  END $$`;

export class AuditLogPartitioning1795863621798 implements MigrationInterface {
  name = 'AuditLogPartitioning1795863621798';

  public async up(q: QueryRunner): Promise<void> {
    // Cria uma partição mensal protegida. Interna: só o dono executa (usada pela migração e pela função de manutenção).
    await q.query(`
      CREATE FUNCTION audit_create_month_partition(month_start date) RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        partition text := format('audit_logs_%s', to_char(month_start, 'YYYY_MM'));
        lower_bound timestamptz := month_start::timestamp AT TIME ZONE 'UTC';
        upper_bound timestamptz := (month_start + interval '1 month')::timestamp AT TIME ZONE 'UTC';
      BEGIN
        IF to_regclass('public.' || partition) IS NOT NULL THEN
          RETURN false;
        END IF;
        EXECUTE format('CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
                       partition, lower_bound, upper_bound);
        -- O gatilho de TRUNCATE não é herdado pelas partições (testado no Postgres 18): um por partição.
        EXECUTE format('CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON %I
                        FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation()', partition);
        -- Os privilégios padrão concederiam UPDATE e DELETE ao perfil da API em cada partição nova.
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
          EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM app_runtime', partition);
        END IF;
        RETURN true;
      END $$`);

    // 1. Tabela nova particionada, com a sequência atual.
    await q.query(`ALTER TABLE audit_logs RENAME TO audit_logs_old`);
    await q.query(`CREATE TABLE audit_logs_new (${COLUMN_DEFS}) PARTITION BY RANGE (occurred_at)`);
    await q.query(`ALTER TABLE audit_logs_new RENAME TO audit_logs`);

    // 2. Partições do mês do registro mais antigo até 12 meses à frente.
    await q.query(`
      DO $$
      DECLARE
        first_month date := date_trunc('month', coalesce((SELECT min(occurred_at) FROM audit_logs_old), now())
                                               AT TIME ZONE 'UTC')::date;
        last_month date := date_trunc('month', (now() + interval '12 months') AT TIME ZONE 'UTC')::date;
        m date := first_month;
      BEGIN
        WHILE m <= last_month LOOP
          PERFORM audit_create_month_partition(m);
          m := (m + interval '1 month')::date;
        END LOOP;
      END $$`);

    // 3. Cópia preservando ids, horários e hashes, com conferência. Um registro fora das partições aborta tudo.
    await q.query(`INSERT INTO audit_logs (${COLUMNS}) SELECT ${COLUMNS} FROM audit_logs_old ORDER BY id`);
    await q.query(CHECK_COPY('audit_logs_old', 'audit_logs'));

    // 4. A sequência passa para a tabela nova e a antiga sai (DROP não dispara os gatilhos de DELETE/TRUNCATE).
    await q.query(`ALTER SEQUENCE audit_logs_id_seq OWNED BY audit_logs.id`);
    await q.query(`DROP TABLE audit_logs_old`);

    // 5. Chave primária (nome que o TypeORM geraria para (id, occurred_at)), índices e imutabilidade.
    await q.query(
      `ALTER TABLE audit_logs ADD CONSTRAINT "PK_422842340cffa0cc4a1092fb3c2" PRIMARY KEY ("id", "occurred_at")`,
    );
    for (const sql of INDEXES) await q.query(sql);
    for (const sql of IMMUTABILITY) await q.query(sql);
    await q.query(
      IF_ROLE(
        'app_runtime',
        `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_runtime;
         GRANT SELECT, INSERT ON audit_logs TO app_runtime;
         GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO app_runtime;`,
      ),
    );

    // 6. Âncoras de expurgo: append-only, gravadas só pela função de expurgo.
    await q.query(`
      CREATE TABLE "audit_purges" (
        "id" BIGSERIAL NOT NULL,
        "partition_name" character varying(63) NOT NULL,
        "purged_through" TIMESTAMP WITH TIME ZONE NOT NULL,
        "rows_removed" bigint NOT NULL,
        "anchor_audit_id" bigint,
        "anchor_prev_hash" bytea,
        "purged_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "audit_purge_after_retention" CHECK ("purged_through" <= "purged_at" - interval '5 years'),
        CONSTRAINT "audit_purge_rows_non_negative" CHECK ("rows_removed" >= 0),
        CONSTRAINT "PK_3f0580fe30c4b09f469ead2718e" PRIMARY KEY ("id")
      )`);
    await q.query(`CREATE TRIGGER audit_purges_immutable BEFORE UPDATE OR DELETE ON audit_purges
                   FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation()`);
    await q.query(`CREATE TRIGGER audit_purges_no_truncate BEFORE TRUNCATE ON audit_purges
                   FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation()`);
    await q.query(
      IF_ROLE(
        'app_runtime',
        `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_purges FROM app_runtime; GRANT SELECT ON audit_purges TO app_runtime;`,
      ),
    );

    // 7. Funções de manutenção, executáveis só pelo perfil app_audit_maintenance (D50).
    await q.query(`
      CREATE FUNCTION audit_ensure_partitions(months_ahead int) RETURNS int
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        first_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
        created int := 0;
      BEGIN
        IF months_ahead IS NULL OR months_ahead < 1 OR months_ahead > 24 THEN
          RAISE EXCEPTION 'Manutenção recusada: meses à frente fora da faixa.';
        END IF;
        FOR i IN 0..months_ahead LOOP
          IF audit_create_month_partition((first_month + make_interval(months => i))::date) THEN
            created := created + 1;
          END IF;
        END LOOP;
        RETURN created;
      END $$`);
    await q.query(`
      CREATE FUNCTION audit_purge_partition(partition_name text) RETURNS bigint
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        oldest text;
        upper_bound timestamptz;
        newest timestamptz;
        removed bigint;
        anchor_id bigint;
        anchor_prev bytea;
      BEGIN
        IF partition_name IS NULL OR partition_name !~ '^audit_logs_[0-9]{4}_[0-9]{2}$' OR NOT EXISTS (
          SELECT 1 FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
          WHERE p.relname = 'audit_logs' AND c.relname = partition_name
        ) THEN
          RAISE EXCEPTION 'Expurgo recusado: partição inválida.';
        END IF;

        SELECT c.relname INTO oldest FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
          JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'audit_logs' ORDER BY c.relname LIMIT 1;
        IF oldest <> partition_name THEN
          RAISE EXCEPTION 'Expurgo recusado: só a partição mais antiga pode ser removida.';
        END IF;

        upper_bound := (to_date(substr(partition_name, 12), 'YYYY_MM') + interval '1 month')::timestamp AT TIME ZONE 'UTC';
        IF upper_bound > now() - interval '5 years' - interval '1 day' THEN
          RAISE EXCEPTION 'Expurgo recusado: partição com menos de 5 anos.';
        END IF;
        EXECUTE format('SELECT max(occurred_at), count(*) FROM %I', partition_name) INTO newest, removed;
        IF newest IS NOT NULL AND newest > now() - interval '5 years' THEN
          RAISE EXCEPTION 'Expurgo recusado: partição com registro de menos de 5 anos.';
        END IF;

        SELECT id, prev_hash INTO anchor_id, anchor_prev FROM audit_logs
          WHERE tableoid <> partition_name::regclass ORDER BY id LIMIT 1;
        INSERT INTO audit_purges (partition_name, purged_through, rows_removed, anchor_audit_id, anchor_prev_hash)
          VALUES (partition_name, upper_bound, removed, anchor_id, anchor_prev);

        EXECUTE format('ALTER TABLE audit_logs DETACH PARTITION %I', partition_name);
        EXECUTE format('DROP TABLE %I', partition_name);
        RETURN removed;
      END $$`);

    // Os privilégios padrão dão EXECUTE em funções ao PUBLIC e ao app_runtime: revogação explícita (R12).
    for (const fn of [
      'audit_create_month_partition(date)',
      'audit_ensure_partitions(int)',
      'audit_purge_partition(text)',
    ]) {
      await q.query(`REVOKE EXECUTE ON FUNCTION ${fn} FROM PUBLIC`);
      await q.query(IF_ROLE('app_runtime', `REVOKE EXECUTE ON FUNCTION ${fn} FROM app_runtime;`));
    }
    await q.query(
      IF_ROLE(
        'app_audit_maintenance',
        `GRANT EXECUTE ON FUNCTION audit_ensure_partitions(int) TO app_audit_maintenance;
         GRANT EXECUTE ON FUNCTION audit_purge_partition(text) TO app_audit_maintenance;
         GRANT SELECT, INSERT ON audit_logs TO app_audit_maintenance;
         GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO app_audit_maintenance;
         GRANT SELECT ON audit_purges TO app_audit_maintenance;`,
      ),
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP FUNCTION IF EXISTS audit_purge_partition(text)`);
    await q.query(`DROP FUNCTION IF EXISTS audit_ensure_partitions(int)`);
    await q.query(`DROP TABLE IF EXISTS audit_purges`);

    // Tabela comum, como na InitialSchema, com cópia conferida.
    await q.query(`ALTER TABLE audit_logs RENAME TO audit_logs_partitioned`);
    await q.query(`CREATE TABLE audit_logs (${COLUMN_DEFS},
      CONSTRAINT "UQ_67c4ff6334797c722a15eec21f1" UNIQUE ("hash"),
      CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
    await q.query(`INSERT INTO audit_logs (${COLUMNS}) SELECT ${COLUMNS} FROM audit_logs_partitioned ORDER BY id`);
    await q.query(CHECK_COPY('audit_logs_partitioned', 'audit_logs'));
    await q.query(`ALTER SEQUENCE audit_logs_id_seq OWNED BY audit_logs.id`);
    await q.query(`DROP TABLE audit_logs_partitioned`);
    await q.query(`DROP FUNCTION IF EXISTS audit_create_month_partition(date)`);

    for (const sql of INDEXES) await q.query(sql);
    for (const sql of IMMUTABILITY) await q.query(sql);
    await q.query(
      IF_ROLE(
        'app_runtime',
        `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_runtime;
         GRANT SELECT, INSERT ON audit_logs TO app_runtime;
         GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO app_runtime;`,
      ),
    );
    await q.query(IF_ROLE('app_audit_maintenance', `REVOKE ALL ON audit_logs FROM app_audit_maintenance;`));
  }
}
