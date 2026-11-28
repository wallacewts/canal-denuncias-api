---
description: 'Lista de tarefas da feature 003: trilha de auditoria completa'
---

# Tasks: Trilha de auditoria completa

**Input**: Design documents from `specs/003-audit-trail/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are MANDATORY for every privacy, security, permission, encryption or audit rule (constitution,
principle VII). Nesta feature, toda história é regra de auditoria: os testes de cada uma vêm antes da implementação e
precisam falhar primeiro. Nos testes de "não vazou", usar também textos curtos (ex.: `XQZ`).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- API em projeto único: `src/` e `test/` na raiz do repositório.
- Testes unitários ao lado do código (`*.spec.ts`); integração em `test/` (`*.e2e-spec.ts`), com o harness da 001
  (`createTestApp`, banco clonado por suíte, `log-capture`).
- Testes que precisam agir como outro perfil de banco (`app_migrator`, `app_audit_maintenance`) abrem conexão própria
  com a URL do perfil, apontando para o banco clonado da suíte.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: decisões registradas, perfil de banco de manutenção e harness com identidade de teste.

- [x] T001 Registrar as decisões D45 a D51 (tabela "Decisões para o registro" de `research.md`) em `docs/adr/README.md`:
      conferir o arquivo antes de escrever (o front pode ter registrado D52 ou outra linha no meio-tempo), usar os
      próximos números livres se D45–D51 estiverem ocupados (e atualizar as referências em `research.md` e `plan.md`),
      e não alterar linhas de outros. A D52 do front já existe logo depois da D44 (commit `15968e2`): inserir D45–D51
      entre a D44 e a D52 e aceitar só o realinhamento de espaços feito pelo Prettier, conferindo com `git diff -w` que
      nenhum conteúdo de outra linha mudou
- [x] T002 Emendar o princípio V em `.specify/memory/constitution.md` seguindo `.claude/skills/speckit-constitution/SKILL.md`:
      "a trilha é append-only; a única remoção permitida é a de partições inteiras após o prazo de guarda, por função
      restrita ao perfil de manutenção, com âncora verificada" (referenciando as decisões de prazo, expurgo e âncora
      registradas na T001); versão 1.0.0 → 1.1.0 (MINOR), Last Amended 2026-11-28, Sync Impact Report atualizado, e
      ajustar o portão V de `.specify/templates/plan-template.md`. A constituição do front não muda
- [x] T003 Criar o perfil `app_audit_maintenance` (LOGIN, senha de `APP_AUDIT_MAINTENANCE_PASSWORD`, `USAGE` no
      schema, sem privilégios padrão) em `docker/postgres/01-roles.sh`, passar a senha de desenvolvimento ao serviço
      `postgres` em `docker-compose.yml` e acrescentar `DATABASE_AUDIT_MAINTENANCE_URL` em `.env.example` e em
      `specs/001-transversal-infrastructure/contracts/environment.md`
- [x] T004 [P] Passar `APP_AUDIT_MAINTENANCE_PASSWORD` e `DATABASE_AUDIT_MAINTENANCE_URL` ao passo de perfis e ao job e2e
      em `.github/workflows/ci.yml`
- [x] T005 [P] Escrever a instrução para o ambiente local em `README.md` (seção Banco de dados): o perfil só é criado
      num volume novo; num volume existente, rodar o trecho de criação do perfil com
      `docker compose exec -T postgres psql -U postgres -d canal_denuncias` (comando completo no README) ou recriar o
      volume com `docker compose down -v` (apaga os dados de desenvolvimento)
- [x] T006 [P] Fazer `test/support/global-setup.ts` criar o perfil `app_audit_maintenance` no cluster de teste quando
      ele não existir (mesmo SQL do `01-roles.sh`), para as migrations concederem os `EXECUTE`
- [x] T007 [P] Criar `test/support/fake-identity.ts` (identidade simulada com `userId` e `roles`, só para testes) e a
      opção `identity` em `createTestApp` (`test/support/test-app.ts`), que substitui a porta `AUTH_IDENTITY`

**Checkpoint**: perfil de manutenção existe no compose, no CI e no cluster de teste; testes conseguem simular um membro
da equipe.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: área administrativa negada por padrão e rotas de fixture usadas pelos testes de todas as histórias.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

### Tests (escritos antes, falhando)

- [ ] T008 [P] Teste de integração da área administrativa em `test/audit/admin-identity.e2e-spec.ts`: rota de fixture
      `@AdminApi` responde 401 sem identidade (com e sem cabeçalhos) e 200 com a identidade de teste; o corpo do 401
      segue o `ApiError` da 001
- [ ] T009 [P] Teste de convenção em `test/conventions/test-only-imports.e2e-spec.ts`: nenhum arquivo de `src/` importa
      `test/support/fake-identity.ts` nem qualquer arquivo de `test/`

### Implementation

- [ ] T010 Criar a porta `AUTH_IDENTITY` com implementação padrão que devolve `null` em
      `src/infra/auth/auth-identity.port.ts` e o guard global `AdminIdentityGuard` (401 sem identidade só na área
      `admin`, lida pelo `API_AREA_METADATA`) em `src/infra/auth/admin-identity.guard.ts`, registrados em
      `src/app.module.ts` (contrato `contracts/audit-module.md`)
- [ ] T011 [P] Criar `test/support/fixtures/audit-fixture.module.ts` com rotas `@PublicApi` e `@AdminApi` de teste
      (leitura simples, rota que lança 403, rota que lança erro e rota que registra uma ação) usadas pelas histórias

**Checkpoint**: tudo em `/api/admin` responde 401 em produção; os testes têm identidade e rotas de fixture.

---

## Phase 3: User Story 1 - Só ações conhecidas, com metadados sem texto livre (Priority: P1) 🎯 MVP

**Goal**: catálogo fechado de ações e tipos de recurso, com metadata validada por ação (AUDIT-01, AUDIT-05).

**Independent Test**: registrar ação do catálogo com metadata válida (aceita), ação fora do catálogo e metadata com
campo extra ou texto livre (recusadas, sem o valor na mensagem nem no log).

### Tests for User Story 1 (mandatory for security and privacy rules) ⚠️

- [ ] T012 [P] [US1] Teste unitário do catálogo em `src/modules/audit/audit-action.enum.spec.ts`: toda ação cabe em 60
      caracteres, todo tipo de recurso em 40, toda ação tem schema de metadata e o catálogo contém as ações da AUDIT-01
      mais `KEYS_REWRAP_RUN` e `AUDIT_LOG_PURGED`
- [ ] T013 [P] [US1] Teste unitário dos schemas em `src/modules/audit/audit-metadata.schemas.spec.ts`: aceita os
      formatos de `contracts/audit-catalog.md`; recusa chave extra, texto livre curto (`XQZ`) e longo, UUID inválido e
      enum desconhecido; o erro só tem códigos e caminhos, sem o valor nem os nomes de chaves recebidas
- [ ] T014 [US1] Teste de integração em `test/audit/audit-record.e2e-spec.ts`: `record()` recusa ação fora do catálogo e
      metadata inválida **antes** de abrir transação (nenhuma linha nova, nenhum lock), sem `XQZ` na mensagem nem no
      log capturado; `USER_CREATED`, `KEYS_REWRAPPED` e `KEYS_REWRAP_RUN` continuam gravando como hoje

### Implementation for User Story 1

- [ ] T015 [P] [US1] Criar `AuditAction` e `AuditResourceType` em `src/modules/audit/audit-action.enum.ts`
- [ ] T016 [P] [US1] Criar `AUDIT_METADATA_SCHEMAS` e o tipo `AuditMetadata<A>` em
      `src/modules/audit/audit-metadata.schemas.ts`, com os tipos restritos de `contracts/audit-catalog.md` (sem
      `text()` nem `z.string()` livre)
- [ ] T017 [US1] Fazer `AuditService.record()` exigir `AuditAction`/`AuditResourceType` e validar a metadata antes da
      transação, com o erro `AuditMetadataRejected` de mensagem fixa e sem `cause`, em
      `src/modules/audit/audit.service.ts` e `src/modules/audit/audit.errors.ts`
- [ ] T018 [US1] Ajustar os chamadores atuais ao catálogo tipado: `src/cli/create-admin.command.ts`,
      `src/modules/crypto/rewrap.service.ts` e `test/support/factories.ts`

**Checkpoint**: nenhuma ação fora do catálogo nem texto livre chega à trilha.

---

## Phase 4: User Story 2 - O ator é descoberto sozinho, sem rastro do denunciante (Priority: P1)

**Goal**: ator, usuário, IP e user-agent determinados pelo contexto, sem que o módulo os informe (AUDIT-03).

**Independent Test**: rota pública com `X-Forwarded-For` grava denunciante sem IP; rota admin com identidade de teste
grava equipe com IP real; comando grava sistema; fora de contexto, recusa.

### Tests for User Story 2 (mandatory for security and privacy rules) ⚠️

- [ ] T019 [P] [US2] Teste unitário em `src/modules/audit/audit-context.spec.ts`: `runAsSystem` define ator sistema,
      `current()` é `null` fora de contexto, o contexto sobrevive a `await` e não vaza entre execuções paralelas
- [ ] T020 [US2] Teste de integração em `test/audit/audit-context.e2e-spec.ts`: rota pública de fixture com
      `X-Forwarded-For` e `User-Agent` grava `REPORTER` sem usuário, IP e user-agent; rota admin com identidade de teste
      grava `STAFF` com o id, o IP real (trust proxy) e user-agent de 300 caracteres truncado em 255; o comando
      `create-admin` grava `SYSTEM` sem IP; `record()` fora de contexto lança `AuditActorUndetermined` sem gravar nada;
      a `AuditEntry` não tem campo de ator, IP ou user-agent (teste de tipo com `@ts-expect-error`)

### Implementation for User Story 2

- [ ] T021 [P] [US2] Criar `AuditContext` sobre `AsyncLocalStorage`, `runAsSystem` e `AuditActorUndetermined` em
      `src/modules/audit/audit-context.ts`
- [ ] T022 [US2] Criar o interceptor global `AuditContextInterceptor` (área `public` → `REPORTER` sem ler cabeçalhos;
      área `admin` → `STAFF` com usuário da porta `AUTH_IDENTITY`, `request.ip` e user-agent truncado) em
      `src/modules/audit/audit-context.interceptor.ts`, registrado em `src/app.module.ts`
- [ ] T023 [US2] Tirar `actorType`, `actorUserId`, `ip` e `userAgent` da `AuditEntry` e fazer `record()` usar o
      contexto em `src/modules/audit/audit.service.ts`
- [ ] T024 [US2] Envolver em `runAsSystem` os chamadores fora de requisição: `src/cli/create-admin.command.ts`,
      `src/cli/rewrap-keys.command.ts` (e o `RewrapService` chamado por ele). Ainda não existe processador de fila:
      criar o helper `src/infra/queue/system-job.ts` (roda o handler de um job dentro de `runAsSystem`), com teste
      unitário em `src/infra/queue/system-job.spec.ts`, para todo processador futuro usar

**Checkpoint**: nenhuma chamada consegue gravar ator, IP ou user-agent à mão; rotas públicas nunca gravam IP.

---

## Phase 5: User Story 3 - Rotas auditadas sem repetir código (Priority: P1)

**Goal**: `@Audited` com resultado sucesso, negado ou falha (AUDIT-04).

**Independent Test**: rota de fixture marcada gera `SUCCESS`, `DENIED` e `FAILURE`; falha de gravação num sucesso vira
500 genérico.

### Tests for User Story 3 (mandatory for security and privacy rules) ⚠️

- [ ] T025 [US3] Teste de integração em `test/audit/audited.e2e-spec.ts`: rota marcada grava exatamente um registro
      `SUCCESS` com o id do recurso; rota que lança 403 grava `DENIED`; rota que lança erro grava `FAILURE` e a resposta
      continua sem dado da requisição; com a gravação forçada a falhar (provider substituído), a rota de sucesso
      responde 500 genérico; o registro nunca contém corpo nem resposta (enviar `XQZ` no corpo e conferir); operação
      que grava na transação e é desfeita não deixa registro

### Implementation for User Story 3

- [ ] T026 [P] [US3] Criar o decorator `@Audited(action, resourceType, resolveId?)` em
      `src/modules/audit/audited.decorator.ts`
- [ ] T027 [US3] Criar o `AuditInterceptor` (sucesso, negado em `ForbiddenException`, falha nos demais erros, 500
      genérico se a gravação de um sucesso falhar; `resolveId` só com parâmetros e query) em
      `src/modules/audit/audit.interceptor.ts`

**Checkpoint**: leituras sensíveis ficam auditadas com uma linha por rota.

---

## Phase 6: User Story 4 - Imutabilidade provada a cada mudança (Priority: P1)

**Goal**: suíte automatizada de imutabilidade no CI (AUDIT-08).

**Independent Test**: a suíte de integração prova as recusas por perfil e a CHECK de IP.

### Tests for User Story 4 (mandatory for security and privacy rules) ⚠️

- [ ] T028 [US4] Teste de integração em `test/audit/audit-immutability.e2e-spec.ts`: com `app_runtime`, `UPDATE` e
      `DELETE` em `audit_logs` falham por permissão; com `app_migrator`, `UPDATE`, `DELETE` e `TRUNCATE` falham pelo
      gatilho; `INSERT` com `actor_type = REPORTER` e `ip` preenchido falha pela CHECK. Escrito de forma a valer também
      depois do particionamento (US7 acrescenta os casos por partição)

### Implementation for User Story 4

- [ ] T029 [US4] Criar em `test/support/db-roles.ts` o helper que abre conexão com um perfil de banco
      (`app_runtime`, `app_migrator`, `app_audit_maintenance`) no banco clonado da suíte, usado pelas US4 e US7

**Checkpoint**: o CI falha se a imutabilidade deixar de valer.

---

## Phase 7: User Story 5 - O Auditor consulta a trilha (Priority: P2)

**Goal**: consulta com filtros e cursor decrescente, só pelo Auditor (AUDIT-06).

**Independent Test**: Auditor de teste recebe páginas decrescentes e filtradas; outro perfil, 403; sem identidade,
401; filtro inválido, 400 sem eco.

### Tests for User Story 5 (mandatory for security and privacy rules) ⚠️

- [ ] T030 [P] [US5] Teste unitário do cursor decrescente em `src/common/pagination/cursor-desc.spec.ts`: ida e volta
      do bigint, recusa de cursor adulterado, não canônico ou curto (`XQZ`)
- [ ] T031 [US5] Teste de integração em `test/audit/audit-query.e2e-spec.ts`: Auditor recebe a primeira página em ordem
      decrescente e o cursor da próxima; cada filtro (ator, ação, tipo, id do recurso, período) restringe; perfil
      `ANALYST` recebe 403 e gera `ACCESS_DENIED`; sem identidade, 401; ação fora do catálogo, período invertido, limite
      fora da faixa e cursor adulterado dão 400 com mensagem fixa e sem o valor; a consulta grava `AUDIT_LOG_VIEWED`
      com os filtros; a resposta tem `Cache-Control: no-store`

### Implementation for User Story 5

- [ ] T032 [P] [US5] Criar `paginateDesc()` e o cursor bigint em `src/common/pagination/cursor-desc.ts`
- [ ] T033 [P] [US5] Criar o schema de filtros e o `AuditQueryService` em `src/modules/audit/audit-query.service.ts`
- [ ] T034 [US5] Criar `GET /api/admin/v1/audit-logs` (perfil `AUDITOR`, `ACCESS_DENIED` nos demais) em
      `src/modules/audit/audit.controller.ts`, registrar no `src/modules/audit/audit.module.ts` e rodar
      `npm run openapi:export` (commitar `openapi/admin.json`)

**Checkpoint**: a trilha pode ser consultada só pelo Auditor.

---

## Phase 8: User Story 6 - Verificação de integridade da cadeia (Priority: P2)

**Goal**: verificação em lotes com ponto de corte, por rota e por comando (AUDIT-07).

**Independent Test**: trilha íntegra resulta íntegra; registro alterado ou removido (só no teste) resulta quebrado com o
id certo; o comando sai com 1 quando quebrada.

### Tests for User Story 6 (mandatory for security and privacy rules) ⚠️

- [ ] T035 [P] [US6] Teste unitário em `src/modules/audit/audit-verifier.service.spec.ts` sobre uma cadeia em memória:
      íntegra, registro alterado, registro removido, gênese errada e trilha vazia
- [ ] T036 [US6] Teste de integração em `test/audit/audit-verifier.e2e-spec.ts`: com o gatilho desligado só no teste
      (superusuário), alterar um registro e remover outro e conferir `ok: false` com o primeiro id afetado; registros
      gravados durante a verificação não causam quebra (ponto de corte); a rota responde ao Auditor, 403 aos demais (com
      `ACCESS_DENIED` gravado) e 401 sem identidade; a verificação grava `AUDIT_CHAIN_VERIFIED`
- [ ] T037 [P] [US6] Teste de integração do comando em `test/cli/verify-audit.e2e-spec.ts`: código 0 e JSON com
      `"ok": true` na trilha íntegra, código 1 na quebrada, registro `SYSTEM` sem IP
- [ ] T038 [P] [US6] Teste de desempenho em `test/audit/audit-performance.e2e-spec.ts`: fixture de 100.000 registros
      encadeados inseridos direto no banco; mede a verificação (meta de 1 minuto) e a memória viva durante ela (amostras
      com `gc()` e `--no-concurrent-array-buffer-sweeping`, como na 002), comparando 10.000 × 100.000 registros para
      provar que não cresce com o tamanho da trilha e a primeira página da consulta com
      filtro (meta de 1 segundo); limites só fora do CI, sempre registrando os valores

### Implementation for User Story 6

- [ ] T039 [US6] Criar o `AuditVerifierService` (ponto de corte, lotes de 1.000, `REPEATABLE READ READ ONLY`,
      `computeAuditHash` da 001; a âncora entra na US7) em `src/modules/audit/audit-verifier.service.ts`
- [ ] T040 [US6] Criar `POST /api/admin/v1/audit-logs/verification` em `src/modules/audit/audit.controller.ts` e rodar
      `npm run openapi:export`
- [ ] T041 [US6] Criar o comando `verify-audit` em `src/cli/verify-audit.command.ts` e registrá-lo em
      `src/cli/cli-commands.module.ts`

**Checkpoint**: adulteração da trilha é detectada por rota e por comando agendável.

---

## Phase 9: User Story 7 - Registros com mais de 5 anos saem da trilha sem quebrar a verificação (Priority: P3)

**Goal**: tabela particionada por mês, expurgo de 5 anos por função restrita e âncora da cadeia (AUDIT-09).

**Independent Test**: num banco de teste com partições de mais e de menos de 5 anos, o `audit-maintenance` remove só as
antigas, grava a âncora e o `AUDIT_LOG_PURGED`, e a verificação continua íntegra; remoção recente, fora de ordem ou
pelo `app_runtime` é recusada; lacuna sem âncora é quebra.

### Tests for User Story 7 (mandatory for security and privacy rules) ⚠️

- [ ] T042 [US7] Teste da migration em `test/audit/audit-partitioning-migration.e2e-spec.ts`: num banco com registros
      na tabela antiga, a migration preserva contagem, ids e hashes e a verificação continua íntegra; o `down()` volta à
      tabela comum com a mesma conferência; a migration aborta se a conferência falhar (simulado)
- [ ] T043 [US7] Estender `test/audit/audit-immutability.e2e-spec.ts` com os casos por partição: `app_runtime` não faz
      `DELETE`, `UPDATE` nem `TRUNCATE` direto numa partição; `app_migrator` não faz `TRUNCATE` numa partição (gatilho);
      `app_runtime` não executa `audit_purge_partition` nem `audit_ensure_partitions`; `audit_purges` é append-only
- [ ] T044 [US7] Teste de integração em `test/audit/audit-retention.e2e-spec.ts`. As partições com mais de 5 anos são
      criadas pelo teste como superusuário (só no teste), com o mesmo gatilho de `TRUNCATE` e os mesmos `REVOKE`s que a
      função aplica, e recebem registros encadeados inseridos direto no banco: `audit_ensure_partitions(3)` cria o que falta, com gatilho e `REVOKE` em cada uma;
      o expurgo remove só a partição mais antiga com mais de 5 anos + 1 dia, grava a âncora e o `AUDIT_LOG_PURGED` na
      mesma transação; recusa partição recente, partição que não é a mais antiga e nome que não é partição (com nome
      curto `XQZ`, sem eco na mensagem); a verificação depois do expurgo é íntegra e informa `anchoredAt`
- [ ] T045 [US7] Teste de âncora forjada em `test/audit/audit-anchor.e2e-spec.ts`: remover registros recentes por fora
      (superusuário, só no teste) resulta em quebra; inserir pelo `app_runtime` um `AUDIT_LOG_PURGED` falso sem linha em
      `audit_purges` resulta em quebra; âncora com `purged_through` mais recente que 5 anos é recusada pela CHECK
- [ ] T046 [P] [US7] Teste do comando em `test/cli/audit-maintenance.e2e-spec.ts`: `--dry-run` não altera nada; sem
      `DATABASE_AUDIT_MAINTENANCE_URL`, recusa com código 1; com o perfil de manutenção, cria partições, expurga e
      imprime o JSON com os totais; com a URL do `app_runtime`, falha por permissão
- [ ] T047 [P] [US7] Teste de prontidão em `test/health.e2e-spec.ts`: `/ready` responde 200 com um detalhe de
      aviso quando há menos de 1 mês de partições à frente, e 503 quando não há partição para o mês corrente ou o
      seguinte (inserções falhariam)

### Implementation for User Story 7

- [ ] T048 [US7] Escrever à mão a migration `src/database/migrations/<ts>-AuditLogPartitioning.ts` conforme
      `contracts/partitioning.md` (tabela particionada, partições até +12 meses com gatilho de `TRUNCATE` e `REVOKE`,
      cópia com conferência de contagem e último hash, sequência, troca de nomes, gatilhos, `REVOKE`/`GRANT`,
      `audit_purges` e as duas funções `SECURITY DEFINER` com `EXECUTE` revogado de `PUBLIC` e `app_runtime` e
      concedido a `app_audit_maintenance` se ele existir), com `down()` funcional
- [ ] T049 [US7] Ajustar a entidade em `src/modules/audit/entities/audit-log.entity.ts` (PK `(id, occurred_at)`, sem
      unicidade de `hash`), criar `src/modules/audit/entities/audit-purge.entity.ts`, registrá-la em
      `src/database/entities.ts` e confirmar que `migration:generate` responde "No changes"
- [ ] T050 [US7] Acrescentar a âncora ao `AuditVerifierService` (regras de `contracts/partitioning.md`) em
      `src/modules/audit/audit-verifier.service.ts`
- [ ] T051 [US7] Criar o `AuditMaintenanceService` (conexão com `DATABASE_AUDIT_MAINTENANCE_URL`, `ensure` e expurgo
      partição a partição, cada expurgo com `AUDIT_LOG_PURGED` na mesma transação, em `runAsSystem`) em
      `src/modules/audit/audit-maintenance.service.ts`
- [ ] T052 [US7] Criar o comando `audit-maintenance` (com `--dry-run`) em `src/cli/audit-maintenance.command.ts` e
      registrá-lo em `src/cli/cli-commands.module.ts`
- [ ] T053 [P] [US7] Criar o indicador de partições à frente no `/ready` em `src/modules/health/`: 200 com aviso com
      menos de 1 mês à frente; 503 sem partição para o mês corrente ou o seguinte
- [ ] T054 [P] [US7] Acrescentar ao perfil `app` do `docker-compose.yml` um serviço de exemplo `audit-maintenance`
      (mesma imagem, comando `node dist/cli.js audit-maintenance`) e escrever o runbook em `docs/deploy/audit/README.md`
      (agendamento diário por cron, timer do systemd ou CronJob; perfil de manutenção; verificação agendada com
      `verify-audit`; o que fazer quando a verificação acusar quebra)

**Checkpoint**: a trilha é guardada por 5 anos e removida por partição sem quebrar a verificação.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T055 [P] Atualizar `AGENTS.md` com as regras novas: ator só pelo contexto (`runAsSystem` fora de requisição),
      ação só do catálogo com schema de metadata, `@Audited` para leituras, área admin negada sem identidade, trilha
      só removida pelo `audit-maintenance`
- [ ] T056 [P] Atualizar `README.md` (comandos `verify-audit` e `audit-maintenance`, perfil `app_audit_maintenance`,
      migration `AuditLogPartitioning`) e marcar os critérios atendidos em `docs/tarefas/02-audit.md`
- [ ] T057 Configurar cobertura mínima de 80% para `src/modules/audit` em `vitest.config.coverage.ts` e conferir com
      `npm run test:cov:all`
- [ ] T058 Rodar o roteiro de `quickstart.md`, o compose `--profile app` (inclusive o serviço `audit-maintenance` e o
      `verify-audit` no container), o Trivy e o gitleaks, e registrar o resultado

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: depende do Setup; bloqueia todas as histórias.
- **US1 (Phase 3)**: depende da fase 2.
- **US2 (Phase 4)**: depende da US1 (as duas mexem em `audit.service.ts`).
- **US3 (Phase 5)**: depende da US2 (usa o contexto).
- **US4 (Phase 6)**: depende só da fase 2; pode rodar em paralelo com US1 a US3.
- **US5 (Phase 7)**: depende da US2 (contexto e identidade) e da US1 (catálogo nos filtros).
- **US6 (Phase 8)**: depende da US1 e da US2; a rota usa o controller da US5 (T040 depois de T034).
- **US7 (Phase 9)**: depende da US4 (helper de perfis), da US6 (verificador) e da US2 (`runAsSystem`).
- **Polish**: depois de todas as histórias.

### User Story Dependencies

```text
Setup → Foundational → US1 → US2 → US3
                    ↘ US4 ──────────────────┐
                       US2 → US5 → US6 ──→ US7 → Polish
```

### Within Each User Story

- Testes escritos antes e falhando; depois a implementação; depois a história inteira verde (lint, typecheck,
  unitários, e2e, build, openapi em dia) e um commit.
- Na US7, a migration (T048) e a entidade (T049) vêm antes da âncora, do serviço e do comando.

### Parallel Opportunities

- Setup: T004, T005, T006 e T007 em paralelo depois de T003.
- Foundational: T008, T009 e T011 em paralelo.
- US1: T012, T013 (testes) e T015, T016 (implementação) em paralelo.
- US4 inteira em paralelo com US1 a US3.
- US5: T030, T032 e T033 em paralelo.
- US6: T035, T037 e T038 em paralelo.
- US7: T046, T047, T053 e T054 em paralelo depois da migration.
- Polish: T055 e T056 em paralelo.

---

## Parallel Example: User Story 1

```bash
# Testes juntos (escritos antes, falhando):
Task: "T012 [US1] Teste do catálogo em src/modules/audit/audit-action.enum.spec.ts"
Task: "T013 [US1] Teste dos schemas em src/modules/audit/audit-metadata.schemas.spec.ts"

# Implementação em paralelo:
Task: "T015 [US1] AuditAction e AuditResourceType em src/modules/audit/audit-action.enum.ts"
Task: "T016 [US1] AUDIT_METADATA_SCHEMAS em src/modules/audit/audit-metadata.schemas.ts"
```

---

## Implementation Strategy

### MVP First

1. Setup e Foundational.
2. US1 a US4 (P1): catálogo, ator por contexto, `@Audited` e imutabilidade provada. Com isso, os módulos de domínio
   (users, reports, case-management, messages) já auditam suas ações sem risco de texto livre nem de IP de denunciante.
3. Validar e parar para revisão.

### Incremental Delivery

1. P1 (US1 a US4) → módulos de domínio liberados.
2. P2 (US5 e US6) → consulta e verificação, obrigatórias antes da produção.
3. P3 (US7) → particionamento e expurgo de 5 anos; a migração da tabela é feita enquanto o volume ainda é pequeno.
4. Polish.

---

## Notes

- [P] = arquivos diferentes, sem dependência entre si.
- O prazo de 5 anos foi decidido pelo usuário e precisa ser validado com o jurídico e o DPO e constar no RIPD.
- A checagem de divergência do TypeORM com a tabela particionada é confirmada na T049; se o TypeORM não lidar com a PK
  composta da tabela particionada, parar e reportar com opções.

---

## Pendências do analyze

| ID  | Severidade | Pendência                                                                                                   | Onde resolver | Situação |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------- | ------------- | -------- |
| U3  | LOW        | A verificação roda em transação de leitura; o `AUDIT_CHAIN_VERIFIED` é gravado depois, em transação própria | T039          | Aberto   |
| C3  | LOW        | Teste de expurgo interrompido: erro depois da âncora desfaz âncora, partição e `AUDIT_LOG_PURGED` juntos    | T044          | Aberto   |
| I2  | LOW        | `src/modules/audit/audit.errors.ts` (T017) fora da árvore do plano                                          | plan.md       | Aberto   |
| I3  | LOW        | `test/support/db-roles.ts` (T029) fora da árvore do plano                                                   | plan.md       | Aberto   |
