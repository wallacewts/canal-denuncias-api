---
description: 'Tarefas da feature 007: controle de acesso (ACL-01 a ACL-05)'
---

# Tasks: Controle de acesso — políticas reais da matriz de permissões

**Input**: Design documents from `specs/007-access-control-policies/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R9), data-model.md, contracts/access-control.md, quickstart.md

**Tests**: obrigatórios para toda regra de permissão, privacidade e auditoria (constituição, princípio VII): cada
teste é escrito antes da implementação e precisa falhar primeiro.

**Organization**: tarefas agrupadas por user story da spec (US1 a US5).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: user story da spec (US1 a US5)

---

## Phase 1: Setup

**Purpose**: decisões registradas antes do código (princípio IX) e documentação de referência ajustada.

- [x] T001 Registrar em `docs/adr/README.md`, depois da última linha existente (conferir o arquivo antes; hoje termina
      em D58; a numeração segue a que estiver livre), com status "Decidido": **D59** denúncia fora do escopo (escopo
      antes do expurgo, 410 só dentro do escopo; 404 idêntico para fora do escopo e inexistente, ambos com
      `ACCESS_DENIED` e `reason` `OUT_OF_SCOPE`/`NOT_FOUND`, mesma consulta e mesma escrita; Q1 = B, Q2 = B); **D60**
      escopo por registro (`recordScope` por perfil no catálogo, aditivo; função única `report-scope.ts` com dois
      intérpretes, WHERE e registro, concordância provada por teste exaustivo); **D61** habilidade na trilha (mapa
      política → tipo de recurso e método → código do catálogo; `ACCESS_DENIED` ganha `code` e `reason`;
      `resourceType` da política); **D62** declaração das rotas (rotas de denúncia declaram a habilidade na rota, 403
      sem ela, e o escopo no serviço, 404; `@Can.Anyone()` só na lista do teste de convenção); **D63** (decisão do
      front, no número seguinte ao último usado): "Front remove a configuração de token XSRF
      (`withXsrfConfiguration`) que ficou inerte: a API protege a área administrativa por verificação de origem
      (`Sec-Fetch-Site`/`Origin`, D53/AUTH-07) com cookie `SameSite=Strict` e não emite token; a constituição do front
      1.0.1 aceita token ou origem." Sem mexer em linhas de outros (`git diff -w`)
- [x] T002 [P] Ajustar `docs/adr/0053-autenticacao-e-autorizacao.md` (ler antes): a frase "Denúncia expurgada
      responde 410 antes da política" vira "o escopo vem antes; 410 só dentro do escopo, fora dele 404 com
      `ACCESS_DENIED` (D59)"; a coluna "Rota" do mapeamento passa às declarações da research R5 (`readAny`,
      `triageAny`, `treatAny`, `requestAny`, `decideAny`, `RetentionPolicy.manage`), sem `@Can.Anyone()` em rota de
      denúncia; o 404 do (\*) passa a valer também para id inexistente (com `reason`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: alcance por registro no catálogo, descritor de escopo, mapa de políticas e metadata padronizada de
`ACCESS_DENIED`. Nenhuma user story começa antes.

- [x] T003 [P] Teste antes em `src/modules/access-control/abilities.spec.ts`: `recordScope` só nas habilidades
      `scope: 'record'`, com chaves iguais aos `roles` de cada uma; valores da tabela da research R1; as células "✅
      (se atribuída)" da matriz de `docs/tarefas/05-access-control.md` correspondem a `assigned` e os ✅ simples das
      habilidades por registro a `all` (FR-002); `abilitiesFor` e códigos inalterados (SC-007)
- [x] T004 `recordScope` aditivo em `src/modules/access-control/abilities.ts` (depois do T003), sem mudar códigos,
      perfis nem `abilitiesFor`; conferir que `src/modules/users/me.schema.ts` e o `GET /me` não mudam
- [x] T005 [P] Teste unitário antes em `src/modules/access-control/report-scope.spec.ts`: `reportScope(user, ability)`
      para perfis isolados e combinados (`all` vence `assigned`; nenhum perfil com a habilidade → `none`; ADMIN e
      AUDITOR sozinhos → `none`); `allowsReport` nega sempre com `blockedForUser`, nega `exists = false`, nega `none`,
      `assigned` só com `assignedToId` igual ao `userId`
- [x] T006 `reportScope` e `allowsReport` em `src/modules/access-control/report-scope.ts` (depois do T005), lendo só
      `recordScope` do catálogo (único lugar que liga perfil a alcance)
- [x] T007 [P] Teste antes em `src/modules/audit/audit-metadata.schemas.spec.ts`: `ACCESS_DENIED` aceita `code` (só
      códigos do catálogo) e `reason` (`OUT_OF_SCOPE`, `NOT_FOUND`), recusa código inventado, motivo fora do enum,
      campo extra e texto (inclusive `XQZ`); `required`, `policy` e `ability` continuam aceitos
- [x] T008 Schema de `ACCESS_DENIED` em `src/modules/audit/audit-metadata.schemas.ts` (depois do T007)
- [x] T009 [P] Teste antes em `src/modules/access-control/policy-abilities.spec.ts`: todo método de política de
      `src/modules/access-control/policies/` registrado no `AccessControlModule` tem entrada no mapa com um código do
      catálogo; toda política tem `resourceType`; a `UsersPolicy` mapeia `manage` e `actOnOther` para `users.manage` e
      `USER`
- [x] T010 Mapa `POLICY_ABILITIES` tipado em `src/modules/access-control/policy-abilities.ts` (depois do T009),
      começando pela `UsersPolicy` (as demais entram nas histórias)
- [x] T011 [P] Teste antes em `src/infra/auth/auth-audit.subscriber.spec.ts`: negação do guard ou do `authorize()`
      grava `metadata { policy, ability, code }` e o `resourceType` do mapa; rota sem declaração (`policy = null`)
      continua `SYSTEM` sem `code`; nenhum id de registro vindo dos argumentos do `@Can()`
- [x] T012 `AuthAuditSubscriber` em `src/infra/auth/auth-audit.subscriber.ts` usando o mapa (depois do T010, T011)
- [x] T013 [P] Fábrica de teste para denúncias sem cifragem em `test/support/factories.ts` (`createBareReport(ds, opções)`, opções
      `assignedToId` e `shreddedAt`, com `INSERT` mínimo em `reports`, e `blockReport(ds, reportId, userId)` em
      `report_access_blocks`), com caso em `test/support/factories.e2e-spec.ts`

**Checkpoint**: catálogo com alcance, descritor de escopo, metadata e assinante prontos.

---

## Phase 3: User Story 1 - Cada perfil faz só o que a matriz permite (Priority: P1) 🎯 MVP

**Goal**: uma política por recurso decidindo cada habilidade da matriz pelo catálogo; rota da trilha migrada para
`audit.read`.

**Independent Test**: teste em tabela perfil (isolado e combinado) × método × situação contra a matriz; Auditor 200 e
demais 403 com `ACCESS_DENIED` na rota da trilha.

### Tests for User Story 1 ⚠️ (escrever antes, devem falhar)

- [x] T014 [P] [US1] Teste em tabela `src/modules/access-control/policies/matrix.spec.ts` (R8): perfis isolados e
      combinações `ADMIN+ANALYST`, `DPO+ANALYST`, `COMPLIANCE_MANAGER+DPO`, `ADMIN+AUDITOR` × cada método das
      políticas × situação (atribuída à pessoa, a outro, sem atribuição, com conflito; pedido de revelação feito pela
      própria pessoa), esperado derivado da matriz e do `recordScope` (≥ 180 casos nos perfis isolados, SC-001);
      inclui DPO lendo e nunca tratando (D20), ADMIN e AUDITOR sozinhos sem nada sobre denúncias, conflito negando
      para Gestora e DPO, `actOnOther` sobre si mesmo negado (D21)
- [x] T015 [P] [US1] Ajustar `test/audit/audit-query.e2e-spec.ts` e `test/audit/audit-verifier.e2e-spec.ts`: outro
      perfil continua 403, e o `ACCESS_DENIED` passa a ter metadata com
      `policy: 'AuditPolicy'`, `ability: 'read'` e `code: 'audit.read'`, e `resource_type = 'audit_log'` (escrita assíncrona do assinante: esperar o registro como em
      `test/contract/auth/authorization.e2e-spec.ts`); Auditor continua 200; sem identidade, 401

### Implementation for User Story 1

- [x] T016 [P] [US1] `ReportsPolicy` em `src/modules/access-control/policies/reports.policy.ts`: `list`, `readAny`,
      `triageAny`, `treatAny` (só `hasAbility`) e `read`, `triage`, `treat` sobre `ReportAccessFacts` (com
      `reportScope`/`allowsReport` da habilidade correspondente)
- [x] T017 [P] [US1] `IdentityRevealPolicy` em `src/modules/access-control/policies/identity-reveal.policy.ts`:
      `requestAny`, `decideAny`, `request(user, facts)`, `decide(user, facts, request)` com
      `requestedById` diferente de `user.id` (four-eyes)
- [x] T018 [P] [US1] `RetentionPolicy` (`manage`, `manageReport`), `SettingsPolicy` (`sla`, `retention`),
      `CatalogPolicy` (`manageCategories`), `AuditPolicy` (`read`) e `DashboardPolicy` (`read`) em
      `src/modules/access-control/policies/` (um arquivo por política)
- [x] T019 [US1] Entradas das novas políticas no `src/modules/access-control/policy-abilities.ts` e registro no
      `src/modules/access-control/access-control.module.ts` (providers e exports) (depois do T016–T018)
- [x] T020 [US1] `src/modules/audit/audit.controller.ts`: `@Can(AuditPolicy, 'read')` nas rotas, sem `@Can.Anyone()`
      nem `assertAuditor` (FR-005); NÃO importar o `AccessControlModule` no `AuditModule` (fecharia um ciclo com o
      `ReportAccessService`, que depende do `AuditService`): a `AuditPolicy` é descoberta pelo registro do pacote;
      conferir que a inicialização não lança `MissingPolicyError` (depois do T019)

**Checkpoint**: matriz decidida pelo servidor; T014 e T015 verdes.

---

## Phase 4: User Story 2 - Acesso a uma denúncia por atribuição e conflito (Priority: P1)

**Goal**: `ReportAccessService.resolve` como único ponto da denúncia por id: 404 idêntico (fora do escopo ou
inexistente) com `ACCESS_DENIED` e motivo, 410 só dentro do escopo, 403 para quem alcança mas não pode a operação.

**Independent Test**: rota só de teste que chama o `resolve` e depois `authorize()`; códigos, corpos e registros na
trilha conferidos; teste de tempo isolado.

### Tests for User Story 2 ⚠️ (escrever antes, devem falhar)

- [x] T021 [P] [US2] Rota só de teste em `test/support/fixtures/report-access-fixture.module.ts` (nunca importada por
      `src/`): `GET /api/admin/v1/report-access-fixture/:id` com `@Can(ReportsPolicy, 'readAny')`, id validado como
      UUID, `resolve(user, id, 'reports.read', { content: true })`; e `POST .../:id/treat` com
      `@Can(ReportsPolicy, 'treatAny')`, `resolve` + `authorize(ReportsPolicy, 'treat')`; e `POST .../:id/decide` com
      `@Can(IdentityRevealPolicy, 'decideAny')`, `resolve` + `authorize('decide', request)` sobre um pedido em
      `identity_reveal_requests`
- [x] T022 [US2] E2e (depois do T021) `test/access-control/report-access.e2e-spec.ts` (sessão real,
      `createTestApp({ vault: 'api' })`): analista atribuído 200; outro analista e id inexistente → 404 com código e corpo idênticos (SC-006) e um
      `ACCESS_DENIED` cada (`resource_type = 'report'`, `resource_id` = id, `code: 'reports.read'`, `reason`
      `OUT_OF_SCOPE`/`NOT_FOUND`); Gestora e DPO bloqueados → 404; expurgada no escopo → 410 `REPORT_SHREDDED`, fora
      do escopo → 404; ADMIN e AUDITOR → 403 na rota (sem consulta à denúncia); DPO tratando → 403; analista tratando
      a de outro → 404; reatribuição vale na requisição seguinte; aprovar o próprio pedido de revelação → 403; id
      malformado → 400 sem `ACCESS_DENIED`; nenhum conteúdo nem texto na metadata (inclusive `XQZ`)
- [x] T023 [US2] Teste de tempo (depois do T021) `test/access-control/report-not-found.timing-spec.ts` (molde do
      `test/auth/sign-in.timing-spec.ts`): 40 amostras alternadas de "existe fora do escopo" e "id inexistente" na
      rota do T021; diferença das medianas < 10% da menor mediana, piso de 1 ms; imprime as medianas no stderr
- [x] T024 [P] [US2] Teste unitário `src/modules/access-control/report-access.service.spec.ts`: ordem fixa consulta →
      escopo → expurgo; os dois 404 chamam a mesma consulta e o mesmo `record()` (só o `reason` muda); 410 só com
      `content: true` e dentro do escopo; dentro do escopo devolve os fatos sem gravar nada

### Implementation for User Story 2

- [x] T025 [US2] `ReportAccessService` em `src/modules/access-control/report-access.service.ts` (research R2):
      consulta única `FROM (VALUES ($1::uuid)) q(id) LEFT JOIN reports r ... LEFT JOIN report_access_blocks b ...`;
      decisão por `allowsReport(reportScope(user, ability), facts)`; negação por `AuditService.record()` com
      `ACCESS_DENIED`, `REPORT`, `resourceId`, `code`, `reason`, seguida da mesma `NotFoundException`; 410 com
      `DomainError` `REPORT_SHREDDED` (D56) (depois do T021–T024)
- [x] T026 [US2] Exportar o `ReportAccessService` no `src/modules/access-control/access-control.module.ts`
      (dependência do `AuditModule`) (depois do T025)

**Checkpoint**: T022, T024 verdes; `npm run test:timing` verde com o T023.

---

## Phase 5: User Story 3 - Listagens filtradas na consulta (Priority: P1)

**Goal**: `scopeReportsFor` aplicando atribuição e bloqueio no `WHERE`, com a mesma regra da leitura por registro.

**Independent Test**: cenário do ACL-03 com conjunto esperado escrito à mão e prova exaustiva "listado ⇔ leitura
permitida" no Postgres real.

### Tests for User Story 3 ⚠️ (escrever antes, devem falhar)

- [ ] T027 [P] [US3] E2e `test/access-control/report-scope.e2e-spec.ts`: (a) cenário do ACL-03 — 3 analistas, 1
      Gestora com bloqueio, 1 DPO com bloqueio, 10 denúncias (algumas sem atribuição): conjunto de cada pessoa igual
      ao esperado escrito à mão; ADMIN e AUDITOR → vazio (SC-002); (b) prova exaustiva com perfis isolados e
      combinados e bloqueios determinísticos: para toda pessoa e denúncia, listado por `scopeReportsFor` ⇔
      `ReportsPolicy.read` sobre os fatos do `resolve` (SC-003); (c) uma única consulta por listagem (contador de
      consultas do `DataSource`), compatível com filtro extra e com `paginate()` (parâmetros `acl_scope_*` sem colisão)

### Implementation for User Story 3

- [ ] T028 [US3] `scopeReportsFor(user, qb, alias = 'r')` em `src/modules/access-control/report-scope.ts` (depois do
      T027): `NOT EXISTS` em `report_access_blocks`, `assigned_to_id` quando `assigned`, `FALSE` quando `none`,
      habilidade `reports.list`
- [ ] T029 [US3] Exemplo da feature 004 (R7): remover `test/contract/auth/example/report-scope.ts` e
      `test/contract/auth/example/report-scope.e2e-spec.ts`; `example.policy.ts` e `example.repository.ts` passam a
      usar `src/modules/access-control/report-scope.ts`; `test/contract/auth/authorization.e2e-spec.ts` e
      `session-expiry.e2e-spec.ts` continuam verdes (depois do T028)

**Checkpoint**: T027 verde; nenhuma outra definição de escopo no repositório (`grep`).

---

## Phase 6: User Story 4 - Negações sempre na trilha (Priority: P2)

**Goal**: todo 403 e todo 404 de denúncia com `ACCESS_DENIED`, `result = DENIED`, habilidade e tipo de recurso.

**Independent Test**: provocar cada tipo de negação e conferir exatamente um registro com a metadata esperada.

### Tests for User Story 4 ⚠️ (escrever antes, devem falhar)

- [ ] T030 [P] [US4] E2e `test/access-control/denials.e2e-spec.ts`: 403 do guard em rota de usuários (`UsersPolicy`,
      `code: users.manage`, `resource_type = 'user'`), na trilha (`AuditPolicy`), na rota de teste (`ReportsPolicy`),
      403 do `authorize()` (DPO tratando) e os dois 404 de denúncia: exatamente um `ACCESS_DENIED` por negação,
      `result = 'DENIED'`, metadata só com nomes de código e enums (SC-005); rota sem declaração continua `SYSTEM`
- [ ] T031 [P] [US4] (parte da `policy`/`ability`/`code` do guard já feita na fase 2, junto com o T012, para a suíte
      continuar verde; falta a reconferência do T032) Ajustar `test/users/users-status.e2e-spec.ts` e `test/users/users-create-list.e2e-spec.ts` para a
      metadata nova (`code` além de `policy`/`ability`; `required: ADMIN` mais `code: 'users.manage'` na reconferência
      dentro da transação)

### Implementation for User Story 4

- [ ] T032 [US4] `src/modules/users/users.service.ts`: a reconferência de quem age passa a gravar também
      `code: 'users.manage'` no `ACCESS_DENIED` (depois do T031)

**Checkpoint**: T030 e T031 verdes.

---

## Phase 7: User Story 5 - Nenhuma rota sem permissão declarada (Priority: P2)

**Goal**: teste de convenção que percorre as rotas administrativas registradas e falha sem declaração.

**Independent Test**: app completo sem rota sem declaração; controller de teste sem declaração é encontrado e
nomeado.

### Tests for User Story 5 ⚠️ (escrever antes, devem falhar)

- [ ] T033 [P] [US5] Sentinela `test/conventions/authorization-metadata.e2e-spec.ts`: aplicar `@Can()` e
      `@Can.Anyone()` a uma classe de teste e conferir que as chaves `authorization:can` e `authorization:can-anyone`
      aparecem no `Reflect` (quebra se o pacote mudar as chaves)
- [ ] T034 [P] [US5] Convenção `test/conventions/admin-routes.e2e-spec.ts` (R4): app completo (`AppModule`, sem
      fixtures); percorre controllers `@AdminApi` pelo `DiscoveryService`/`MetadataScanner`; cada handler tem
      `@Can()` com política do mapa, ou `OpenAdminRoute`/`StepRoute`, ou `@Can.Anyone()` numa lista explícita com
      motivo (`GET /me` e rotas de `me-security`); falha nomeando a rota; logger de captura: nenhum "declare no check"
      na inicialização (SC-004); caso negativo com um controller de teste sem declaração num app separado

### Implementation for User Story 5

- [ ] T035 [US5] Corrigir o que o T034 apontar (nenhuma rota esperada fora da lista depois do T020); manter a lista
      explícita no próprio teste, com o motivo de cada entrada (depois do T034)

**Checkpoint**: T033 e T034 verdes.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T036 [P] Regras no `AGENTS.md` (ler antes): rota de denúncia declara a habilidade na rota e usa
      `ReportAccessService.resolve` no serviço (nada de 404/410 próprio); listagem de denúncias só com
      `scopeReportsFor`; alcance por registro só no `recordScope` do catálogo; método novo de política = entrada no
      `policy-abilities.ts`; `@Can.Anyone()` só na lista do teste de convenção
- [ ] T037 [P] Backlog e ADR: marcar os critérios atendidos do ACL-01 a ACL-05 em `docs/tarefas/05-access-control.md`
      (ler antes) e atualizar a seção "O que já existe e o que cada tarefa seguinte constrói" do ADR 0053 (políticas,
      `scopeReportsFor`, `ReportAccessService`, contrato em `specs/007-access-control-policies/contracts/`)
- [ ] T038 [P] Comentários desatualizados: `src/infra/auth/admin-identity.guard.ts` (menção à ACL-02) e cabeçalho de
      `src/infra/auth/auth-audit.subscriber.ts`
- [ ] T039 Cobertura mínima de 80% em `src/modules/access-control` no `vitest.config.coverage.ts`
- [ ] T040 `npm run openapi:export` sem diferença em `openapi/` (nenhuma rota real mudou; o `GET /me` igual, SC-007)
- [ ] T041 Rodar os cenários do `quickstart.md` e a suíte completa, cada um separado: lint, typecheck, format,
      unitários, e2e, `npm run test:timing`, build e openapi em dia; gitleaks

---

## Dependencies & Execution Order

- **Setup (T001–T002)**: T001 antes de qualquer código; T002 em paralelo.
- **Foundational (T003–T013)**: depois do Setup; bloqueia as histórias. Pares teste → implementação: T003→T004,
  T005→T006, T007→T008, T009→T010, T011→T012 (este também depois do T010). T013 independente.
- **US1 (T014–T020)**: depois da Foundational.
- **US2 (T021–T026)**: depois da US1 (usa `ReportsPolicy` e `IdentityRevealPolicy`).
- **US3 (T027–T029)**: depois da US2 (a prova exaustiva usa os fatos do `resolve`).
- **US4 (T030–T032)**: depois da US2 (cobre os 404); independente da US3.
- **US5 (T033–T035)**: depois da US1 (rota da trilha migrada); independente da US2 a US4.
- **Polish (T036–T041)**: depois das histórias desejadas.

## Parallel Opportunities

- Setup: T002 com o T001 já feito.
- Foundational: T003, T005, T007, T009, T011 e T013 juntos; depois T004, T006, T008, T010; por fim T012.
- US1: T014, T015, T016, T017 e T018 juntos; depois T019 → T020.
- US2: T021 e T024 juntos; T022 e T023 depois do T021 (usam a rota de teste); depois T025 → T026.
- US4 e US5 em paralelo entre si depois da US2/US1 (T030, T031, T033, T034 juntos).
- Polish: T036, T037 e T038.

### Parallel Example: User Story 1

```text
Task: "T014 teste em tabela da matriz em src/modules/access-control/policies/matrix.spec.ts"
Task: "T015 ajuste dos e2e da trilha para a metadata nova"
Task: "T016 ReportsPolicy"
Task: "T017 IdentityRevealPolicy"
Task: "T018 Retention/Settings/Catalog/Audit/Dashboard policies"
```

### Parallel Example: User Story 2

```text
Task: "T021 rota só de teste do resolve"
Task: "T022 e2e de 404/410/403 e ACCESS_DENIED"
Task: "T023 teste de tempo dos dois 404"
Task: "T024 unitário do ReportAccessService"
```

## Implementation Strategy

### MVP First

1. Setup + Foundational.
2. US1 (matriz decidida pelo servidor, trilha migrada) → validar sozinha com o T014 e o T015.
3. Parar e validar: as features de domínio já podem declarar permissões nas rotas.

### Incremental Delivery

1. US1 → MVP.
2. US2 + US3 → acesso por registro e listagem filtrada (fecha a P1; destrava reports e case-management).
3. US4 e US5 → trilha das negações e convenção.
4. Polish (AGENTS.md, backlog, ADR, cobertura, suíte completa).

## Notes

- Commits locais por fase/história na implementação, Conventional Commits, sem `--no-verify`, sem push (só quando o
  usuário pedir).
- Nunca `down -v` no Postgres local. Nunca abrir arquivo para escrita antes de ler.
- Nada de `test/` importado por `src/`; a rota do T021 fica só em `test/support/fixtures/`.
- Nenhuma migration nesta feature (R9).

## Pendências do analyze

Achados opcionais da análise de 2026-11-28, a resolver durante a implementação ou depois:

- **A2** (spec.md SC-001): a conta "5 × 12 × 3 = 180" mistura habilidades globais, que não variam por situação, com
  métodos de política; reformular como "todas as combinações perfil × método × situação aplicável".
- **F2** (spec.md FR-011/FR-017): deixar explícito que "habilidade" na trilha é o código do catálogo (`code`), e que
  `ability` é o nome do método da política.
- **F3** (T015): os e2e da trilha podem continuar com a identidade de teste, porque a `AuditPolicy.read` só consulta a
  habilidade; a regra do AGENTS.md sobre sessão real vale para política sobre o usuário da sessão.
