#!/bin/sh
# Executado uma única vez, na criação do volume do Postgres.
# app_migrator: dono do schema, usado só pelo job de migrations.
# app_runtime:  usado pela API. Só DML, e sem UPDATE/DELETE em audit_logs (revogado na migration AuditImmutability).
# app_audit_maintenance: só para o comando audit-maintenance (partições e expurgo de 5 anos da trilha, D50). Recebe
#   os privilégios na migration AuditLogPartitioning; não herda os privilégios padrão do app_runtime.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE ROLE app_migrator LOGIN PASSWORD '${APP_MIGRATOR_PASSWORD}';
CREATE ROLE app_runtime  LOGIN PASSWORD '${APP_RUNTIME_PASSWORD}';
CREATE ROLE app_audit_maintenance LOGIN PASSWORD '${APP_AUDIT_MAINTENANCE_PASSWORD}';

ALTER DATABASE "${POSTGRES_DB}" OWNER TO app_migrator;
ALTER SCHEMA public OWNER TO app_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_audit_maintenance;

ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_runtime;
EOSQL
