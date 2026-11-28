# Trilha de auditoria: operação

Como manter e verificar a trilha de auditoria em produção (feature 003, decisões D45 a D51 em `docs/adr/README.md`).

## O que roda e com que perfil

| Comando                              | Para quê                                                                        | Perfil de banco         | Variável                         | Frequência              |
| ------------------------------------ | ------------------------------------------------------------------------------- | ----------------------- | -------------------------------- | ----------------------- |
| `node dist/cli.js audit-maintenance` | Cria 3 meses de partições à frente e remove as partições que passaram de 5 anos | `app_audit_maintenance` | `DATABASE_AUDIT_MAINTENANCE_URL` | 1 vez por dia           |
| `node dist/cli.js verify-audit`      | Recalcula a cadeia de hash e acusa adulteração                                  | `app_runtime`           | `DATABASE_URL`                   | 1 vez por dia (ou mais) |

Os dois rodam com a mesma imagem da API e as mesmas variáveis de ambiente dela, **fora do processo da API**. A API
nunca tem permissão para remover nada da trilha.

## Perfil de manutenção

- `app_audit_maintenance` é criado pelo script de perfis do banco (`docker/postgres/01-roles.sh`). Em produção,
  crie-o com senha forte, guardada no cofre de segredos, antes de rodar a migration `AuditLogPartitioning` (é ela que
  concede os privilégios).
- Ele só pode executar `audit_ensure_partitions` e `audit_purge_partition`, ler e inserir em `audit_logs` (para gravar
  o `AUDIT_LOG_PURGED`) e ler `audit_purges`.
- Se a migration já tiver rodado antes de o perfil existir, não é preciso desfazê-la: crie o perfil e conceda os
  privilégios com o bloco final da migration (`GRANT EXECUTE ...`), como superusuário.

## Agendamento

Escolha um dos agendadores do ambiente. Exemplos:

**cron (host com Docker):**

```cron
# Manutenção da trilha às 02:15 e verificação às 03:15, horário do servidor
15 2 * * * docker run --rm --env-file /etc/canal/api.env -e DATABASE_AUDIT_MAINTENANCE_URL --network canal canal-denuncias-api:<versão> node dist/cli.js audit-maintenance
15 3 * * * docker run --rm --env-file /etc/canal/api.env --network canal canal-denuncias-api:<versão> node dist/cli.js verify-audit
```

**Kubernetes:** dois `CronJob` com a imagem da API, `command: ["node", "dist/cli.js", "audit-maintenance"]` e
`["node", "dist/cli.js", "verify-audit"]`, `restartPolicy: Never` e `concurrencyPolicy: Forbid`.

No ambiente local, o serviço `audit-maintenance` do perfil `app` do `docker-compose.yml` roda o comando uma vez.

## Saídas e códigos

- `audit-maintenance`: `{"partitionsCreated":0,"partitionsPurged":1,"rowsRemoved":1234}`. Código 0 sucesso, 1 erro.
  `--dry-run` mostra o que faria sem alterar nada.
- `verify-audit`: `{"ok":true,"checked":123456,"firstBrokenId":null,"anchoredAt":"789"}`. Código 0 íntegra, 1
  quebrada, 2 erro de execução.

Configure o agendador para **alertar** sempre que o código for diferente de zero.

## O que fazer quando a verificação acusar quebra

1. Não apague nem altere nada. Guarde a saída do comando (`firstBrokenId`).
2. Restrinja o acesso de escrita ao banco e avise o DPO e a segurança: uma cadeia quebrada indica alteração ou remoção
   de registros por alguém com acesso direto ao banco.
3. Compare o trecho a partir do `firstBrokenId` com o backup mais recente para identificar o que mudou.
4. Registre o incidente. A trilha não é "consertada": a quebra fica como evidência.

## /ready e partições

O `/ready` da API acusa a falta de partições:

- partições para o mês corrente e o seguinte, mas não para depois: 200 com aviso (rode o `audit-maintenance`);
- falta a partição do mês corrente ou do seguinte: 503 (a API sai de rotação, porque gravar na trilha falharia).

## Prazo de guarda

5 anos após o registro (D49), decidido pelo usuário em 2026-11-28. **Pendente:** validação com o jurídico e o DPO e
registro no RIPD. Os backups seguem a D26 (tempo indeterminado) e não são alcançados pelo expurgo.
