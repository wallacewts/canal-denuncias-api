# Tasks: Decisão das bibliotecas de autenticação e autorização

**Input**: Design documents from `specs/004-auth-library-decision/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: obrigatórios para toda regra de segurança, privacidade, permissão, criptografia e auditoria (constituição,
princípio VII). Escreva cada teste antes da implementação e confirme que falha.

**Organization**: por user story. Definitivo em `src/` (stores de sessão e de MFA, migration, entidades, ponte de
identidade, configuração dos módulos); teste de contrato em `test/contract/auth/` (login, MFA, rotas e políticas de
exemplo), conforme FR-023. Só sessão por cookie: não há tokens de acesso nem de renovação (Q-P2 revista, R3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: US1 a US4 da spec

---

## Phase 1: Setup

**Purpose**: decisões registradas antes do código (princípio IX) e dependência.

- [x] T001 Registrar D53 (autenticação: `@nestjs/authentication` 0.1.8 com sessão por cookie no servidor, MFA TOTP,
      guard global, sem renovação por tokens, stores Postgres, segredo TOTP selado pelo `AppSecretService`) e D54
      (autorização: `@nestjs/authorization` 0.1.4, negação por padrão, filtro pela mesma função de escopo) em
      `docs/adr/README.md`, depois da D52, conferindo o arquivo antes e sem mexer em linhas de outros (aceitar só o
      realinhamento do Prettier, conferido com `git diff -w`); marcar a D10 como "Alterada pela D54" (CASL → pacote
      oficial)
- [x] T002 [P] Instalar `@nestjs/authorization@0.1.4` com versão exata em `package.json` e `package-lock.json` (npm
      11.20 do Node 26.13.1, `.tool-versions`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: modelo de dados, os dois stores definitivos e a configuração dos módulos. Nenhuma user story de protótipo
começa antes.

**⚠️ CRITICAL**: US2, US3 e US4 dependem desta fase.

### Testes da fase (escrever antes)

- [x] T003 [P] Teste da migration `AuthStores` (sobe e desce; colunas, CHECKs e `UNIQUE (user_id, code_hash)`;
      `typeorm migration:generate` sem divergência depois de aplicada) em
      `test/contract/auth/auth-stores.migration.e2e-spec.ts`
- [x] T004 [P] Suíte `authenticationStoreContract()` de `@nestjs/authentication/testing` com `concurrent: true` contra
      `PgSessionStore` e `PgMfaStore` no Postgres da suíte em `test/contract/auth/store-contract.e2e-spec.ts`
- [x] T005 [P] Teste do `PgMfaStore`: o valor gravado em `users.mfa_secret_enc` e `users.mfa_pending_secret_enc` nunca
      contém o segredo base32 e só abre com o `AppSecretService` do mesmo usuário; nenhuma chamada ao Vault acontece
      com transação aberta (espiar `queryRunner.isTransactionActive`) em `test/contract/auth/pg-mfa-store.e2e-spec.ts`
- [x] T006 [P] Teste do catálogo: ações `AUTH_SIGNED_IN`, `AUTH_SIGNED_OUT`, `AUTH_MFA_FAILED`, `AUTH_SESSION_REVOKED`
      e `ACCESS_DENIED` aceitas só com a metadata do contrato; senha, código, token ou id de sessão na metadata são
      recusados sem eco (inclusive `XQZ`) em `src/modules/audit/audit-action.enum.spec.ts` e
      `src/modules/audit/audit-metadata.schemas.spec.ts`
- [x] T007 [P] Teste da área pública: rota `@PublicApi` não lê nem emite cookie de sessão, ignora `Authorization` e
      continua sem IP na auditoria; `/health` e `/ready` abertos em `test/contract/auth/public-area.e2e-spec.ts`

### Implementação da fase

- [x] T008 Migration à mão `src/database/migrations/<timestamp>-AuthStores.ts` conforme `data-model.md` (ajusta
      `sessions`, `users` e `recovery_codes`; cria `mfa_failures` e o enum `session_mfa_state`; `down()` restaura o
      formato anterior)
- [x] T009 [P] Entidades: ajustar `src/modules/auth/entities/session.entity.ts`, `recovery-code.entity.ts` e
      `src/modules/users/entities/user.entity.ts`; criar `src/modules/auth/entities/mfa-failure.entity.ts`; registrar em
      `src/database/entities.ts`
- [x] T010 [P] Acrescentar `users.mfa_pending_secret_enc` em `ENCRYPTED_FIELDS`
      (`src/modules/crypto/encryption-context.ts`) e nos campos aceitos pelo `src/modules/crypto/app-secret.service.ts`
- [x] T011 [P] `PgSessionStore` em `src/infra/auth/stores/pg-session.store.ts` (contrato em `contracts/stores.md`:
      leitura com `JOIN users` no `extra`, `touchSession` condicional, `deleteSession` com contagem)
- [x] T012 [P] `PgMfaStore` em `src/infra/auth/stores/pg-mfa.store.ts` (sela antes do `UPDATE` e abre depois do
      `SELECT` com o `AppSecretService`; `claimTotpStep`, `consumeRecoveryCode` e `recordMfaFailure` em uma instrução)
- [x] T013 Provider singleton que registra os dois stores com `AuthenticationStorage.registerSource({ sessions, mfa })`
      em `src/infra/auth/auth-storage.provider.ts`
- [x] T014 Acrescentar as ações do T006 ao catálogo e aos schemas em `src/modules/audit/audit-action.enum.ts` e
      `src/modules/audit/audit-metadata.schemas.ts`
- [x] T015 Configurar `AuthenticationModule` (opções de `contracts/auth-integration.md`: `idleTtl` 15m, `absoluteTtl`
      8h, `sameSite: 'strict'`, `mfa.encryption: false`, sem `accessToken`, `allowInMemoryStorage: false`) e depois
      `AuthorizationModule` em `src/infra/auth/auth-infra.module.ts`; criar `src/infra/auth/staff-session.provider.ts`
      (`SessionCookieProvider`, usuário e perfis recarregados a cada requisição, `DISABLED` → `null`)
- [x] T016 `@PublicApi` passa a compor `@Public()` em `src/common/http/route-decorators.ts`; `@Public()` em `/health`,
      `/ready` (`src/modules/health/`) e no Swagger (`src/app.setup.ts`)
- [x] T017 Apoio de teste: relógio controlável injetado em `SessionService` e `MfaService` e opção
      `createTestApp({ auth: 'real' })` (stores Postgres reais, módulo de exemplo) em `test/support/auth-clock.ts` e
      `test/support/test-app.ts`; o módulo de exemplo `test/contract/auth/example/example.module.ts` (só de teste,
      nunca importado por `src/`)

**Checkpoint**: migration, stores (com o contrato do pacote verde), catálogo e módulos configurados; suíte existente
continua verde.

---

## Phase 3: User Story 1 - Decisão registrada com critérios verificáveis (Priority: P1) 🎯 MVP

**Goal**: quem vai implementar login e permissões encontra a escolha, as alternativas, a tabela requisito × opção com
evidência, os riscos e o impacto.

**Independent Test**: ler o registro e conferir que cada requisito FR-005 a FR-021 aparece com o resultado de cada
opção e a evidência (teste do protótipo ou documentação).

- [ ] T018 [US1] ADR detalhado em `docs/adr/0053-autenticacao-e-autorizacao.md` (modelo `docs/adr/template.md`):
      escolha, alternativas (passport/express-session/otplib/CASL), tabela requisito × opção com a evidência de cada
      linha (arquivo de teste do protótipo ou trecho da documentação), decisão de não usar renovação por tokens com o
      histórico da Q-P2 e o ponto de partida para um canal futuro (R3), riscos do 0.1.x com mitigação e ponto de saída
      pela `AUTH_IDENTITY`, impacto em D03, D10, D32 e no modelo de dados; linkar a partir das linhas D53/D54 de
      `docs/adr/README.md`
- [ ] T019 [US1] Marcar os critérios de aceite de AUTH-00 em `docs/tarefas/04-auth.md` e de ACL-00 em
      `docs/tarefas/05-access-control.md`, com a referência à D53/D54 e ao ADR; conferir que o AUTH-02 já está ajustado
      (auditoria `AUTH_SIGNED_OUT`/`AUTH_SESSION_REVOKED`, sem `AUTH_TOKEN_REUSED` e sem refresh token, feito na correção I2
      do analyze)

**Checkpoint**: US1 verificável só lendo os documentos.

---

## Phase 4: User Story 2 - Login com MFA e sessão segura provados no protótipo (Priority: P1)

**Goal**: provar no protótipo MFA obrigatório, tempo constante, cookie seguro, expirações, sessão no banco, troca do id
e encerramento de todas as sessões do usuário.

**Independent Test**: as suítes abaixo passam contra o Postgres, inclusive reiniciando o app entre login e acesso.

### Testes da US2 (escrever antes)

- [x] T020 [P] [US2] Login e MFA em `test/contract/auth/sign-in-mfa.e2e-spec.ts`: só senha → rota protegida 401;
      senha + TOTP → 200; mesmo código recusado na segunda vez; sessão pendente expira em 10 min; e-mail inexistente e
      senha errada com a mesma resposta e diferença de tempo menor que 10% da verificação em 20 tentativas de cada;
      cookie `__Host-sid` com `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`; token fora do corpo e da URL; id da
      sessão trocado depois do login e depois do MFA; `Authorization: Bearer` numa rota protegida → 401; a trilha recebe `AUTH_SIGNED_IN` no login
      verificado, `AUTH_MFA_FAILED` no código errado e `AUTH_SIGNED_OUT` na saída, sem senha, código, token ou id de
      sessão na metadata (conferir também com valores curtos como `XQZ`)
- [x] T021 [P] [US2] Expirações, persistência e encerramento em `test/contract/auth/session-expiry.e2e-spec.ts`: com
      relógio controlado, 401 depois de 15 min sem uso e depois de 8 h de uso contínuo; sessão válida depois de
      reiniciar o app; `NODE_ENV=production` com store em memória não sobe; falha do store no login não deixa nada em
      memória; com várias sessões do usuário, `revokeAll` faz nenhuma autenticar a requisição seguinte; usuário
      desativado recusado na requisição seguinte; perfil retirado de um usuário com sessão aberta vale na requisição
      seguinte (rota que exigia o perfil passa a dar 403); `revokeAll` grava `AUTH_SESSION_REVOKED`

### Implementação da US2

- [x] T022 [US2] Rotas de exemplo só de teste em `test/contract/auth/example/example-auth.controller.ts`: entrar com
      senha, cadastrar e confirmar TOTP do usuário de teste, verificar o código, sair, sair de todos os lugares (chama
      `signOutEverywhere`/`revokeAll` e grava `AUTH_SESSION_REVOKED` explicitamente pelo `AuditService`, porque o pacote
      não emite evento para isso) e uma rota protegida
- [x] T023 [US2] Assinante de `AuthenticationEvents.events$` (`sign-in`, `sign-out`, `mfa-failed`) gravando pelo `AuditService` no contexto da requisição em `src/infra/auth/auth-audit.subscriber.ts`

**Checkpoint**: US2 provada; o pacote atende sem código próprio de criptografia ou protocolo.

---

## Phase 5: User Story 3 - Permissões negadas por padrão e filtro no banco provados (Priority: P1)

**Goal**: negação por padrão, regras por perfil e por registro, filtro de listagem pela mesma regra e `ACCESS_DENIED`.

**Independent Test**: com usuários de perfis diferentes, conferir respostas, a consulta da listagem e a trilha.

### Testes da US3 (escrever antes)

- [x] T024 [P] [US3] Autorização em `test/contract/auth/authorization.e2e-spec.ts`: rota sem regra → 403 e listada no
      log da inicialização; regra "só Gestor" → Analista 403, Gestor 200; Analista lista só os atribuídos e sem o
      bloqueado por conflito, com a condição já na consulta (capturar o SQL); DPO lê e recebe 403 ao tratar (D20);
      autoalteração de perfis → 403 (D21); toda negação grava `ACCESS_DENIED` sem conteúdo; sem sessão → 401
- [x] T025 [P] [US3] Concordância política × consulta em `test/contract/auth/example/report-scope.e2e-spec.ts`: para
      combinações geradas de perfis, atribuições e bloqueios sobre `reports` e `report_access_blocks`, o conjunto
      listado pelo repositório é exatamente o conjunto em que a política permite leitura

### Implementação da US3

- [x] T026 [US3] Função de escopo única (predicado para a política e condição de consulta para o repositório) em
      `test/contract/auth/example/report-scope.ts`, com política de exemplo `test/contract/auth/example/example.policy.ts`
      e repositório de exemplo `test/contract/auth/example/example.repository.ts`
- [x] T027 [US3] Rotas de exemplo com `@Can()` (sem regra, só Gestor, leitura do DPO, tratar, alterar os próprios
      perfis, listagem) em `test/contract/auth/example/example-admin.controller.ts`
- [x] T028 [US3] Assinar `AuthorizationEvents` (`denied`) no `src/infra/auth/auth-audit.subscriber.ts` para gravar
      `ACCESS_DENIED` com `{ policy, ability }`

**Checkpoint**: princípio IV provado com o pacote escolhido.

---

## Phase 6: User Story 4 - Encaixe com o que já existe (Priority: P2)

**Goal**: hash atual aceito, sessão real alimentando a `AUTH_IDENTITY` e a trilha registrando a equipe pela sessão.

**Independent Test**: criar o administrador pelo comando existente, entrar e conferir a auditoria.

- [ ] T029 [P] [US4] Encaixe em `test/contract/auth/integration.e2e-spec.ts`: administrador criado por `create-admin`
      entra sem migração de hash; rota `@AdminApi` auditada grava ator equipe com o id do usuário da sessão; sem
      sessão continua 401 (D47); a área pública não recebe nem lê cookie
- [x] T030 [US4] (antecipada para a US2: sem a ponte, nenhuma rota administrativa autentica pela sessão) `SessionAuthIdentity` em `src/infra/auth/session-auth-identity.ts` (lê o `AuthenticationContext`;
      `null` sem sessão verificada) substituindo o `NoAuthIdentity` no `AUTH_IDENTITY` de
      `src/infra/auth/auth-infra.module.ts`; manter a identidade simulada dos testes existentes funcionando
- [ ] T031 [US4] Mapear cada linha da matriz do ACL-01 (regra por rota, checagem no serviço ou filtro na consulta) no
      ADR `docs/adr/0053-autenticacao-e-autorizacao.md`

**Checkpoint**: decisão provada sem refazer as features 001 e 003.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T032 [P] Regras novas no `AGENTS.md`: área administrativa só com sessão por cookie; nenhum token portador (canal
      de tokens só por decisão própria futura, R3); stores só Postgres; `@PublicApi` já abre a rota no guard global;
      nada de `@Public()` em rota administrativa
- [ ] T033 [P] `README.md`: suítes de contrato de `test/contract/auth/` e como rodá-las
- [ ] T034 Cobertura mínima de 80% em `src/infra/auth` no `vitest.config.coverage.ts`
- [ ] T035 `npm run openapi:export` e conferir que `openapi/` não mudou (as rotas de exemplo são só de teste)
- [ ] T036 Rodar os cenários de `quickstart.md`, a suíte completa (lint, typecheck, unitários, e2e, build), o compose
      `--profile app` (área pública sem cookie, admin 401 sem sessão), Trivy e gitleaks

---

## Dependencies & Execution Order

- **Setup (T001–T002)**: T001 primeiro (princípio IX); T002 em paralelo.
- **Foundational (T003–T017)**: testes T003–T007 em paralelo, antes da implementação. T008 → T009 → (T010, T011, T012
  em paralelo) → T013 → T014 → T015 → T016 → T017.
- **US1 (T018–T019)**: pode começar logo depois do Setup (é documentação), mas as evidências da tabela apontam para os
  testes de US2/US3; conclui depois deles.
- **US2 (T020–T023)**: depende da Foundational.
- **US3 (T024–T028)**: depende da Foundational; T028 edita o mesmo arquivo do T023 (rodar depois do T023).
- **US4 (T029–T031)**: depende da Foundational; T030 edita `auth-infra.module.ts` (depois do T015); T031 depois do
  T018.
- **Polish (T032–T036)**: depois das user stories.

```text
Setup ─> Foundational ─┬─> US2 ─┐
                       ├─> US3 ─┼─> US1 (fecha a tabela) ─> US4 ─> Polish
                       └────────┘
```

## Parallel Example

```text
# Foundational, testes juntos:
T003 migration · T004 contrato dos stores · T005 selagem do MFA · T006 catálogo · T007 área pública
# Foundational, depois de T008/T009:
T010 campo cifrado · T011 PgSessionStore · T012 PgMfaStore
# US2 e US3, testes juntos:
T020 · T021 · T024 · T025
```

## Implementation Strategy

- **MVP**: Setup + Foundational + US2 + US3 + US1. A decisão (US1) só é útil com a prova (US2 e US3), por isso o MVP é
  a decisão provada: stores definitivos, login com MFA e sessão segura, negação por padrão e filtro na consulta.
- **Depois**: US4 (encaixe com `AUTH_IDENTITY` e auditoria pela sessão), que destrava a feature 04-auth.
- Cada fase termina com tudo verde e um commit; testes antes da implementação em todas as fases.

## Pendências do analyze

| ID  | Severidade | Pendência                                                                                                                                                       | Onde resolver   |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| U2  | LOW        | Árvore do plano sem `src/infra/auth/auth-storage.provider.ts`, `test/support/auth-clock.ts`; teste de migration em `test/contract/auth/` (não `test/database/`) | Polish (T036)   |
| C3  | LOW        | Caso de borda "relógio ajustado": recuar o relógio não renova a sessão                                                                                          | T021 (opcional) |
| C4  | LOW        | SC-007 é validação humana: passo manual no quickstart                                                                                                           | T036            |
| D1  | LOW        | Complexity Tracking ainda estima "~600 linhas" incluindo tokens                                                                                                 | Polish (T036)   |
