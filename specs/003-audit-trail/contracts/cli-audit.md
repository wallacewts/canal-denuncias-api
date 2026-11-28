# Contrato: comandos de linha de comando

## verify-audit

`npm run cli -- verify-audit` (ou `node dist/cli.js verify-audit` no container), com `DATABASE_URL` do `app_runtime`.

- Saída: uma linha JSON `{ "ok": true, "checked": 1234, "firstBrokenId": null, "anchoredAt": null }`.
- Código de saída: 0 íntegra; 1 quebrada; 2 erro de execução (mensagem fixa).
- Grava `AUDIT_CHAIN_VERIFIED` com ator sistema.

## audit-maintenance

`node dist/cli.js audit-maintenance [--dry-run]`, com `DATABASE_AUDIT_MAINTENANCE_URL` (perfil
`app_audit_maintenance`). Feito para rodar uma vez por dia por agendador do sistema.

1. `audit_ensure_partitions(3)`: garante 3 meses de partições à frente.
2. Para cada partição vencida (mais antiga primeiro): numa transação, `audit_purge_partition(nome)` e
   `AUDIT_LOG_PURGED` pelo `AuditService` com ator sistema.
3. Saída: uma linha JSON `{ "partitionsCreated": n, "partitionsPurged": n, "rowsRemoved": n }`.
4. `--dry-run` lista o que faria, sem alterar nada.
5. Código de saída: 0 sucesso; 1 recusa ou erro (mensagem fixa). Sem a variável de ambiente, recusa.
