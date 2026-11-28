# Data Model: Trilha de auditoria completa

## audit_logs (já existe; passa a ser particionada)

Colunas sem mudança: `id` (bigint, sequência), `occurred_at` (timestamptz), `actor_type`, `actor_user_id`, `action`
(varchar 60), `resource_type` (varchar 40), `resource_id` (varchar 64), `result`, `ip` (inet), `user_agent`
(varchar 255), `metadata` (jsonb), `prev_hash` (bytea), `hash` (bytea).

| Mudança                          | Antes                                                                                   | Depois                                                                         | Motivo                                            |
| -------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| Particionamento                  | tabela comum                                                                            | `PARTITION BY RANGE (occurred_at)`, partições mensais `audit_logs_aaaa_mm`     | expurgo por partição (R7)                         |
| Chave primária                   | `(id)`                                                                                  | `(id, occurred_at)`                                                            | toda restrição única precisa da chave de partição |
| Unicidade de `hash`              | `UNIQUE (hash)`                                                                         | removida                                                                       | idem; a verificação cobre (R6)                    |
| Índices                          | `(action, occurred_at)`, `(actor_user_id, occurred_at)`, `(resource_type, resource_id)` | os mesmos, na tabela-pai (herdados)                                            | consulta (R5)                                     |
| CHECK `audit_ip_only_for_staff`  | sim                                                                                     | mantida                                                                        | anonimato                                         |
| Gatilho de linha (UPDATE/DELETE) | na tabela                                                                               | na tabela-pai, herdado pelas partições                                         | imutabilidade                                     |
| Gatilho de TRUNCATE              | na tabela                                                                               | na tabela-pai **e em cada partição**                                           | não é herdado (testado)                           |
| Privilégios `app_runtime`        | INSERT, SELECT                                                                          | INSERT, SELECT na pai; `UPDATE`/`DELETE`/`TRUNCATE` revogados em cada partição | privilégios padrão concederiam (testado)          |

Entidade `AuditLog`: `occurredAt` passa a ser `@PrimaryColumn` junto com `id`; sai o `unique` de `hash`.

## audit_purges (nova)

Âncoras de expurgo. Append-only (gatilhos de UPDATE, DELETE e TRUNCATE; `app_runtime` só `SELECT`). Só a função
`audit_purge_partition` insere.

| Coluna             | Tipo              | Regra                                                                 |
| ------------------ | ----------------- | --------------------------------------------------------------------- |
| `id`               | bigint (identity) | PK                                                                    |
| `partition_name`   | varchar(63)       | nome da partição removida                                             |
| `purged_through`   | timestamptz       | limite superior da partição removida; `<= purged_at - 5 anos` (CHECK) |
| `rows_removed`     | bigint            | `>= 0` (CHECK)                                                        |
| `anchor_audit_id`  | bigint            | id do primeiro registro restante (nulo se a trilha ficou vazia)       |
| `anchor_prev_hash` | bytea             | `prev_hash` desse registro (nulo se vazia)                            |
| `purged_at`        | timestamptz       | `now()` da transação                                                  |

Entidade `AuditPurge` em `entities.ts`, somente leitura no código da API.

## Catálogo (código, sem tabela)

- `AuditAction`: as ações da AUDIT-01 mais `KEYS_REWRAP_RUN` e `AUDIT_LOG_PURGED`; todas com até 60 caracteres.
- `AuditResourceType`: `user`, `session`, `category`, `setting`, `report`, `message`, `attachment`, `identity`,
  `internal_note`, `key`, `audit_log`, `reporting`, `system`; todos com até 40 caracteres.
- Formato de metadata por ação: ver [contracts/audit-catalog.md](./contracts/audit-catalog.md).

## Contexto do ator (memória, sem tabela)

| Origem                          | `actor_type` | `actor_user_id` | `ip`                       | `user_agent`                   |
| ------------------------------- | ------------ | --------------- | -------------------------- | ------------------------------ |
| Rota `@PublicApi`               | `REPORTER`   | nulo            | nulo                       | nulo                           |
| Rota `@AdminApi` com identidade | `STAFF`      | id do membro    | `request.ip` (trust proxy) | até 255 caracteres             |
| Rota `@AdminApi` sem identidade | —            | —               | —                          | — (o guard responde 401 antes) |
| Job, comando (`runAsSystem`)    | `SYSTEM`     | nulo            | nulo                       | nulo                           |
| Fora de contexto                | —            | —               | —                          | — (`record()` recusa)          |

## Resultado da verificação

`{ ok: boolean, checked: number, firstBrokenId: string | null, anchoredAt: string | null }`, em que `anchoredAt` é o
id do registro-âncora quando a cadeia começa depois de um expurgo.

## Transições

- Partição: criada por `audit_ensure_partitions` (até 3 meses à frente; a migration cria até 12) → recebe inserções →
  removida por `audit_purge_partition` quando o limite superior tem mais de 5 anos + 1 dia e ela é a mais antiga.
- Âncora: cada expurgo grava uma; a verificação usa a mais recente.
