# Contrato: partições, funções, perfis, âncora e migração

## Perfis

| Perfil                         | Em `audit_logs` (pai) | Nas partições                          | `audit_purges` | Funções de manutenção |
| ------------------------------ | --------------------- | -------------------------------------- | -------------- | --------------------- |
| `app_runtime` (API)            | INSERT, SELECT        | sem UPDATE/DELETE/TRUNCATE (revogados) | SELECT         | sem EXECUTE           |
| `app_audit_maintenance` (novo) | INSERT, SELECT        | —                                      | SELECT         | EXECUTE nas duas      |
| `app_migrator` (dono)          | dono                  | dono                                   | dono           | dono (definer)        |

## Funções (`SECURITY DEFINER`, `SET search_path = public`, `EXECUTE` revogado de `PUBLIC` e `app_runtime`)

### audit_ensure_partitions(months_ahead int) → int

Cria as partições mensais que faltam do mês corrente até `months_ahead` meses à frente; em cada uma cria o gatilho de
`TRUNCATE` e revoga `UPDATE`, `DELETE`, `TRUNCATE` de `app_runtime`. Devolve quantas criou. `months_ahead` entre 1 e 24.

### audit_purge_partition(partition_name text) → bigint

1. A partição precisa existir em `pg_inherits` como filha de `audit_logs` (o nome nunca é concatenado sem `format('%I')`).
2. Precisa ser a mais antiga.
3. O limite superior precisa ser `<= now() - interval '5 years' - interval '1 day'` e o maior `occurred_at` dela
   também.
4. Conta as linhas, lê o primeiro registro restante (menor `id` fora da partição) e insere a âncora em `audit_purges`.
5. `DETACH PARTITION` e `DROP TABLE`. Devolve o número de linhas removidas.

Qualquer condição violada: `RAISE EXCEPTION` com mensagem fixa, sem o nome recebido.

## Âncora na verificação

1. Primeiro registro com `prev_hash` = gênese: cadeia sem expurgo.
2. Senão: precisa existir a âncora mais recente com `anchor_audit_id` = id do primeiro registro, `anchor_prev_hash` =
   `prev_hash` dele, `purged_through <= purged_at - 5 anos`, `occurred_at` do primeiro registro `>= purged_through`, e
   a cadeia restante precisa conter o `AUDIT_LOG_PURGED` correspondente (mesma partição e total).
3. Qualquer outra lacuna: quebra.

## Migração (`AuditLogPartitioning`)

Uma transação: tabela nova particionada → partições do mês mais antigo até +12 meses (com gatilho de `TRUNCATE` e
`REVOKE`) → cópia preservando `id`, `occurred_at`, `prev_hash`, `hash` → conferência de contagem e último hash (aborta
se diferente) → sequência movida → tabela antiga removida e nova renomeada → gatilhos, `REVOKE`/`GRANT`, `audit_purges`
e funções. `down()` faz o inverso com a mesma conferência.
