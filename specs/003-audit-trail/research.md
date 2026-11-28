# Research: Trilha de auditoria completa

Decisões técnicas da feature 003. Cada uma vira uma linha em `docs/adr/README.md` (D45 a D51) na primeira tarefa,
com os números conferidos no arquivo antes de escrever: o front registra decisões no mesmo arquivo.

Comportamentos do PostgreSQL 18 citados abaixo foram **testados** num banco temporário do Postgres local
(`part_probe`, criado e removido no teste) em 2026-11-28:

| Teste                                                                                       | Resultado                                                                                               |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Gatilho de linha (`BEFORE UPDATE OR DELETE ... FOR EACH ROW`) criado na tabela particionada | é clonado para cada partição: `DELETE` direto numa partição falha                                       |
| Gatilho de `TRUNCATE` (`FOR EACH STATEMENT`) criado na tabela particionada                  | **não** é clonado: `TRUNCATE` direto numa partição passa                                                |
| Privilégios padrão (`ALTER DEFAULT PRIVILEGES ... GRANT ... DELETE ... TO app_runtime`)     | valem também para cada partição criada depois                                                           |
| Função `SECURITY DEFINER` do dono que faz `DROP TABLE <partição>`                           | funciona; com `REVOKE EXECUTE ... FROM PUBLIC, app_runtime`, o perfil da API recebe `permission denied` |
| `information_schema.tables`                                                                 | mostra a tabela-pai e as partições como `BASE TABLE`                                                    |

## R1 · Catálogo de ações e metadados tipados (AUDIT-01, AUDIT-05)

- **Decisão**: `AuditAction` como enum TypeScript (string), com as ações da AUDIT-01 mais `KEYS_REWRAP_RUN` e
  `AUDIT_LOG_PURGED`, e `AuditResourceType` como enum. Um mapa `AUDIT_METADATA_SCHEMAS: Record<AuditAction, ZodType>`
  define o formato de metadados de cada ação com `z.strictObject` e só tipos restritos: `uuid()`, enums, números,
  datas ISO, booleanos e códigos com regex fechada (nunca `z.string()` livre nem `text()`). O `AuditService.record()`
  passa a exigir `action: AuditAction` e valida a metadata pelo schema da ação **antes** de abrir a transação da trilha.
- **Rationale**: o tipo impede ação fora do catálogo em tempo de compilação, e a validação em tempo de execução cobre
  chamadas montadas dinamicamente. Sem `text()`, não existe caminho para texto livre (princípio II). O teste do
  catálogo confere que cada nome cabe em `varchar(60)` e que toda ação tem schema.
- **Erros**: `AuditEntryRejected` com mensagem fixa e sem `cause`, com a lista de códigos de issue do zod e os
  caminhos, nunca os valores (mesmo mapeamento da feature 001; `unrecognized_keys` não lista as chaves).
- **Alternativas**: tabela de ações no banco (rejeitada: o catálogo muda junto com o código, e uma tabela exigiria
  migration para cada ação); metadata livre com lista de chaves proibidas (rejeitada: lista negra sempre falha aberta).

## R2 · Contexto do ator (AUDIT-03)

- **Decisão**: `AuditContext` sobre `AsyncLocalStorage` (`node:async_hooks`), sem dependência nova. O contexto é
  aberto em três pontos e só neles:
  - **rotas**: um interceptor global lê a área da rota (`API_AREA_METADATA` dos decorators `@PublicApi`/`@AdminApi`
    da feature 001). Área `public` → ator `REPORTER`, sem usuário, IP nem user-agent (os cabeçalhos nunca são lidos).
    Área `admin` → ator `STAFF`, com o usuário vindo de uma porta `AUTH_IDENTITY` (ver R3), o IP de `request.ip`
    (com o `trust proxy` da 001) e o user-agent truncado em 255.
  - **jobs e CLI**: `runAsSystem(fn)`, chamado pelos processadores de fila e pelos comandos `nest-commander`.
- **`record()` não aceita ator, usuário, IP nem user-agent** (FR-012): esses campos saem da `AuditEntry`. Fora de um
  contexto aberto, `record()` lança `AuditActorUndetermined` (FR-011). `create-admin` e o `RewrapService` passam a
  rodar dentro de `runAsSystem`.
- **Rationale**: o módulo não tem como informar o ator errado, e uma rota pública nunca consegue gravar IP (princípio
  I), com a CHECK do banco como última defesa. `AsyncLocalStorage` atravessa `await` e a transação do TypeORM.
- **Alternativas**: `nestjs-cls` (rejeitada: dependência para algo que `AsyncLocalStorage` faz em ~40 linhas);
  provider com escopo de requisição (rejeitada: não alcança jobs e CLI e torna request-scoped toda a cadeia de
  injeção).

## R3 · Rotas administrativas antes da autenticação

- **Decisão**: uma porta `AUTH_IDENTITY` (`resolve(request) → { userId, roles } | null`) com implementação padrão que
  sempre devolve `null`, e um guard global `AdminIdentityGuard` para a área `admin`: sem identidade, 401 (negado por
  padrão, princípio IV). As rotas do Auditor exigem também o perfil `AUDITOR` (403 para os demais). Nos testes, um
  provider de identidade **só de teste** (`test/support/fake-identity.ts`, nunca importado por `src/`) substitui a
  porta pelo `createTestApp`. A feature de autenticação (AUTH-06) troca a implementação padrão; a ACL-02 assume a
  checagem de perfil.
- **Rationale**: as user stories 5 e 6 fecham com teste, e nada fica aberto em produção. Um teste de convenção
  confirma que `src/` não importa o provider de teste.
- **Alternativas**: não criar as rotas até a autenticação existir (rejeitada: deixa AUDIT-06/07 sem fechar); variável
  de ambiente para liberar acesso (rejeitada: um interruptor que abre a área administrativa é exatamente o risco).

## R4 · Auditoria declarativa (AUDIT-04)

- **Decisão**: `@Audited(action, resourceType, resolveId)` mais um `AuditInterceptor`. Depois do handler, grava
  `SUCCESS`; com `ForbiddenException`, `DENIED` (e relança); com qualquer outro erro, `FAILURE` (e relança). Se a
  gravação falhar numa resposta de sucesso, o interceptor troca a resposta por erro genérico 500 (FR-015). O
  `resolveId` recebe só parâmetros de rota e a query validada, nunca o corpo nem a resposta (FR-014). Operações que
  alteram dados continuam chamando `record()` com o `EntityManager` da transação (FR-016).
- **Rationale**: leituras sensíveis ficam auditadas com uma linha por rota, e o erro original nunca vai para a
  metadata.
- **Alternativas**: auditar no filtro de exceções (rejeitada: não vê sucessos).

## R5 · Consulta da trilha (AUDIT-06)

- **Decisão**: `GET /api/admin/v1/audit-logs` com filtros validados por zod (`actorUserId` UUID, `action` e
  `resourceType` do catálogo, `resourceId` com regex fechada, `from`/`to` ISO com `from <= to`, `limit` 1 a 100).
  Paginação por cursor **decrescente** sobre o `id` bigint: um `paginateDesc()` irmão do `paginate()` da 001, com cursor
  opaco próprio (base64url do bigint em forma canônica). A consulta grava `AUDIT_LOG_VIEWED` com os filtros
  (identificadores, códigos e datas) e usa os índices que já existem (`action, occurred_at`, `actor_user_id,
occurred_at`, `resource_type, resource_id`), recriados na tabela particionada. Com `from`/`to`, o planejador descarta
  as partições fora do período.
- **Rationale**: o `paginate()` da 001 é ascendente e supõe UUID; a trilha usa bigint e ordem decrescente.
- **Alternativas**: OFFSET (proibido pelo AGENTS.md).

## R6 · Verificação da cadeia (AUDIT-07)

- **Decisão**: `AuditVerifierService.verify()` lê o maior `id` no início (ponto de corte), percorre a trilha em lotes
  de 1.000 por `id` crescente (`WHERE id > :ultimo AND id <= :corte ORDER BY id LIMIT 1000`), recalcula cada hash com
  o `computeAuditHash` da 001 e compara `prev_hash` com o hash anterior. Devolve `{ ok, checked, firstBrokenId }`.
  Roda com o perfil `app_runtime` (só leitura na prática) e numa transação `REPEATABLE READ READ ONLY`, para enxergar
  uma fotografia consistente sem bloquear gravações. Disponível por `POST /api/admin/v1/audit-logs/verification`
  (síncrono, perfil Auditor) e pelo comando `verify-audit` (código de saída 1 se quebrada). Grava
  `AUDIT_CHAIN_VERIFIED`.
- **Rationale**: memória constante, sem lock de escrita. A meta de 100.000 registros em menos de 1 minuto (SC-006) é
  folgada para leitura sequencial em lotes; o valor medido entra no relatório da fase.
- **Âncora depois do expurgo**: ver R9.
- **Alternativas**: verificação assíncrona por fila (adiada: com 100 mil registros abaixo de 1 minuto, síncrono basta;
  vira job quando o volume pedir).

## R7 · Particionamento da trilha (AUDIT-09)

- **Decisão**: `audit_logs` vira tabela particionada por intervalo de `occurred_at`, com **partições mensais**
  (`audit_logs_aaaa_mm`).
  - A chave primária passa a ser `(id, occurred_at)` e a restrição única de `hash` deixa de existir: no Postgres, toda
    restrição única de tabela particionada precisa incluir a chave de partição. A unicidade do hash nunca foi a
    proteção da cadeia; a verificação (R6) detecta qualquer duplicação ou troca.
  - A entidade `AuditLog` passa a declarar `occurredAt` também como coluna primária, e o `@Index` de `hash` sai, para a
    checagem de divergência do CI continuar sem diferenças.
  - Sem partição `DEFAULT`: com ela, criar o mês correspondente falharia se houvesse linhas daquele período. Em vez
    disso, a migration cria partições até 12 meses à frente e o comando de manutenção (R10) garante sempre 3 meses à
    frente. Se faltar partição, a inserção falha e a operação auditada é desfeita (falha fechada, princípio V), e o
    `/ready` passa a acusar quando houver menos de 1 mês de partições à frente.
- **Rationale**: o expurgo de 5 anos vira remoção de partição inteira (R8), sem `DELETE` linha a linha numa tabela
  append-only. Partição mensal limita o excesso de guarda a no máximo 1 mês além dos 5 anos.
- **Alternativas**: partição anual (rejeitada: guardaria até 1 ano além do prazo); `pg_partman` (rejeitada: extensão
  que exige superusuário e não existe na imagem); `DELETE` com o gatilho desligado (rejeitada: exige desligar a
  imutabilidade, que é a garantia central).

## R8 · Expurgo de 5 anos sem quebrar a imutabilidade

- **Decisão**: o expurgo é feito por uma função `SECURITY DEFINER` do dono do schema,
  `audit_purge_partition(partition_name text)`, que:
  1. confere que o nome é de uma partição de `audit_logs` (consulta a `pg_inherits`, nunca concatena texto do
     chamador; usa `format('%I')`);
  2. recusa se o limite superior da partição for posterior a `now() - interval '5 years' - interval '1 day'` ou se o
     maior `occurred_at` dela tiver menos de 5 anos (FR-029);
  3. recusa se não for a partição mais antiga (a remoção é sempre do início, nunca do meio);
  4. registra a âncora em `audit_purges` (R9) e faz `DETACH PARTITION` e `DROP TABLE`, tudo na mesma transação.
  - `EXECUTE` revogado de `PUBLIC` e de `app_runtime` (os privilégios padrão concedem `EXECUTE` em funções a
    `app_runtime`, então o `REVOKE` explícito é obrigatório) e concedido só a um perfil novo, `app_audit_maintenance`.
  - O comando `audit-maintenance` (`nest-commander`, conexão própria com `DATABASE_AUDIT_MAINTENANCE_URL`) chama a função
    para cada partição vencida e grava `AUDIT_LOG_PURGED` pelo `AuditService` **na mesma transação** da remoção, com
    ator sistema (princípio V).
- **Imutabilidade nas partições** (por causa dos testes acima):
  - o gatilho de linha da tabela-pai cobre cada partição automaticamente;
  - o gatilho de `TRUNCATE` é criado **em cada partição** pela função que cria partições (R10) e pela migration;
  - os privilégios de `UPDATE`, `DELETE` e `TRUNCATE` são revogados de `app_runtime` **em cada partição** no momento da
    criação (os privilégios padrão concederiam);
  - `app_runtime` não executa as funções de manutenção.
  - O dono do schema (`app_migrator`) continua podendo remover uma tabela, como todo dono no Postgres; isso é tratado
    como risco operacional de quem roda migrations e é **detectado** pela verificação (R9), que acusa qualquer
    lacuna sem âncora registrada.
- **Automação**: o comando roda por agendador do sistema (cron, timer do systemd ou CronJob), não dentro da API: a API
  roda com `app_runtime`, que de propósito não pode remover nada. O `docker-compose` ganha um serviço de exemplo no
  perfil `app`, e o runbook em `docs/deploy/audit/README.md` mostra o agendamento diário.
- **Alternativas**: job do BullMQ dentro da API com uma segunda conexão privilegiada (rejeitada: põe o poder de
  remover a trilha no processo exposto à internet); `DELETE` por função `SECURITY DEFINER` que desliga o gatilho
  (rejeitada: remove linha a linha e precisa desligar a proteção).

## R9 · Âncora da cadeia depois do expurgo

- **Decisão**: tabela `audit_purges` (append-only, mesmos gatilhos e `REVOKE`; só a função `SECURITY DEFINER` insere):
  `id`, `partition_name`, `purged_through` (limite superior da partição removida), `rows_removed`,
  `anchor_audit_id` e `anchor_prev_hash` (id e `prev_hash` do primeiro registro que restou), `purged_at`. A verificação
  (R6) passa a funcionar assim:
  1. Se o primeiro registro existente tem `prev_hash` igual ao valor de gênese, a cadeia começa nele (sem expurgo).
  2. Senão, ela só é aceita se existir em `audit_purges` a âncora mais recente com `anchor_audit_id` igual ao primeiro
     registro, `anchor_prev_hash` igual ao `prev_hash` dele, `purged_through <= purged_at - 5 anos` e o primeiro
     registro com `occurred_at >= purged_through`.
  3. Além disso, a trilha restante precisa conter o registro `AUDIT_LOG_PURGED` daquela âncora (mesma partição, mesmo
     total), verificado dentro da própria cadeia: o registro do expurgo é protegido pelo encadeamento dos registros
     posteriores.
  - Qualquer outra lacuna, no início ou no meio, resulta em quebra (FR-030).
- **Por que ninguém "recomeça" a cadeia**: apagar registros recentes exige permissão que `app_runtime` não tem; uma
  âncora só nasce dentro da função de expurgo, que só remove partições com mais de 5 anos; e a âncora precisa bater com
  um `AUDIT_LOG_PURGED` encadeado. Quem tem o poder de dono do schema e remove partições recentes por fora produz uma
  lacuna sem âncora coerente, e a verificação acusa.
- **Alternativas**: registrar a âncora só na metadata do `AUDIT_LOG_PURGED` (rejeitada: `app_runtime` pode inserir na
  trilha diretamente e forjaria um registro); assinar a âncora com uma chave do Vault (adiada: protege contra o dono do
  schema, mas é mais complexidade do que o risco pede agora; registrada como evolução).

## R10 · Criação antecipada de partições

- **Decisão**: função `SECURITY DEFINER` `audit_ensure_partitions(months_ahead int)` (mesmo perfil de `EXECUTE` que a
  de expurgo), que cria as partições que faltam até `months_ahead` meses à frente e, em cada uma, cria o gatilho de
  `TRUNCATE` e revoga `UPDATE`, `DELETE` e `TRUNCATE` de `app_runtime`. O comando `audit-maintenance` chama primeiro
  `audit_ensure_partitions(3)` e depois expurga; por isso o mesmo agendamento diário cuida das duas coisas.
- **Rationale**: criar partição exige ser dono da tabela; a função restringe o que o perfil de manutenção pode fazer.

## R11 · Migração da tabela existente

- **Decisão**: uma migration escrita à mão (`AuditLogPartitioning`), numa única transação:
  1. cria `audit_logs_new` particionada, com as mesmas colunas, a PK `(id, occurred_at)`, os índices e a CHECK de IP;
  2. cria as partições do mês do registro mais antigo até 12 meses à frente, com gatilho de `TRUNCATE` e `REVOKE` em
     cada uma;
  3. copia os registros com `INSERT ... SELECT` preservando `id`, `occurred_at`, `prev_hash` e `hash` (a cópia é
     inserção, que os gatilhos permitem);
  4. confere que as contagens e o último `hash` são iguais, e aborta a migration se não forem;
  5. move a sequência do `id` para a tabela nova (`ALTER SEQUENCE ... OWNED BY`) e ajusta o valor;
  6. remove a tabela antiga e renomeia a nova para `audit_logs` (o dono pode remover; os gatilhos de `DELETE` e
     `TRUNCATE` não disparam em `DROP`);
  7. recria os gatilhos de imutabilidade na tabela-pai, os `REVOKE`s e os `GRANT`s de `INSERT`/`SELECT` para
     `app_runtime`, e cria `audit_purges` e as funções de manutenção.
  - O `down()` faz o caminho inverso, com a mesma conferência de contagem e último hash.
  - O teste da migration roda contra um banco com registros, verifica a cadeia antes e depois e confirma a
    imutabilidade na tabela nova.
- **Rationale**: o Postgres não converte tabela comum em particionada no lugar. A cópia dentro de uma transação, com
  conferência, não perde registro nem quebra a cadeia, e o volume atual é pequeno.
- **Alternativas**: anexar a tabela antiga como uma partição (`ATTACH PARTITION`) (rejeitada: a tabela antiga tem a
  restrição única de `hash` e a PK só em `id`, incompatíveis com a tabela particionada sem recriá-la).

## R12 · Perfil de banco de manutenção da trilha

- **Decisão**: novo perfil `app_audit_maintenance` (LOGIN), criado pelo `docker/postgres/01-roles.sh` e pelo passo de
  perfis do CI, com `USAGE` no schema, `EXECUTE` só nas duas funções de manutenção, `SELECT` e `INSERT` em
  `audit_logs` (para gravar o `AUDIT_LOG_PURGED`) e nada mais. A migration concede os `EXECUTE` com o mesmo bloco
  `DO $$ IF EXISTS (pg_roles) $$` da `AuditImmutability`. Variável `DATABASE_AUDIT_MAINTENANCE_URL`, usada só pelo
  comando `audit-maintenance`; o schema de ambiente da API não a exige.
- **Rationale**: separa o poder de remover a trilha do processo da API e do perfil de migrations do dia a dia.

## R13 · Tamanho da trilha e desempenho

- **Decisão**: medir SC-006 e SC-007 com uma fixture que insere 100.000 registros encadeados direto no banco de teste
  (sem passar pelo serviço, para não levar minutos), registrar os valores medidos e aplicar os limites só fora do CI
  (mesmo critério da D41).

## Decisões para o registro (D45 a D51)

| #   | Tema                               | Decisão                                                                                                                                       |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| D45 | Catálogo da auditoria              | Enum `AuditAction` fechado e metadata por ação com `strictObject` sem texto livre                                                             |
| D46 | Ator da auditoria                  | Determinado pelo contexto (`AsyncLocalStorage`), nunca informado pelo módulo; fora de contexto, recusa                                        |
| D47 | Área administrativa antes do login | Porta `AUTH_IDENTITY` que devolve `null` por padrão: tudo em `/api/admin` dá 401 até a AUTH-06                                                |
| D48 | Particionamento da trilha          | Partições mensais por `occurred_at`, PK `(id, occurred_at)`, sem unicidade de `hash`                                                          |
| D49 | Prazo da trilha                    | 5 anos após o registro, por remoção de partição inteira; validar com jurídico e DPO e registrar no RIPD                                       |
| D50 | Expurgo da trilha                  | Funções `SECURITY DEFINER` executáveis só pelo perfil `app_audit_maintenance`, chamadas pelo comando `audit-maintenance` agendado fora da API |
| D51 | Âncora da cadeia                   | Tabela `audit_purges` gravada só pela função de expurgo, conferida contra o `AUDIT_LOG_PURGED` encadeado                                      |
