# Tasks: Login da equipe, MFA, senha e sessões

**Input**: Design documents from `specs/006-staff-sign-in/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: obrigatórios para toda regra de segurança, privacidade, permissão e auditoria (constituição, princípio VII).
Escreva cada teste antes da implementação, com entradas curtas e casos de borda (inclusive concorrência), e confirme
que falha. Os e2e usam `createTestApp({ vault: 'api' })`, `TestClock` no `AUTH_CLOCK` e captura de log; "não vazou"
também com trecho curto (`XQZ`).

**Organization**: por user story (US1 a US5 da spec). A US3 (troca de senha) vem antes da US2 (primeiro acesso),
porque o primeiro acesso usa a troca.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: US1 a US5 da spec

---

## Phase 1: Setup

**Purpose**: decisão registrada antes do código (princípio IX), dependências e configuração.

- [x] T001 Registrar a D57 em `docs/adr/README.md` depois da última linha existente (conferir o arquivo antes; a
      numeração segue a que estiver livre): login da equipe com etapas calculadas (`nextStep`), 401 só para sessão
      ausente ou expirada, 422 `MFA_CODE_INVALID`, 423 `MFA_LOCKED`, 403 `PASSWORD_CHANGE_REQUIRED` (R11), segundo
      fator antes da troca obrigatória (Q2), bloqueio progressivo e limite de tentativas configuráveis (throttler com
      storage no Redis e chave de conta por HMAC), QR code PNG (`uqr` + `node:zlib`); sem mexer em linhas de outros
      (`git diff -w`)
- [x] T002 [P] Instalar `@nestjs/throttler@6.7.1` e `uqr@0.1.3` com versão exata em `package.json` e
      `package-lock.json`
- [x] T003 [P] Variáveis novas no `src/config/env.schema.ts` com os padrões aprovados e validação (inteiros positivos,
      teto ≥ base): `LOGIN_LOCKOUT_THRESHOLD` (5), `LOGIN_LOCKOUT_BASE_MINUTES` (15), `LOGIN_LOCKOUT_MAX_MINUTES`
      (1440), `AUTH_RATE_LIMIT_IP_LIMIT` (20), `AUTH_RATE_LIMIT_IP_WINDOW_SECONDS` (60), `AUTH_RATE_LIMIT_ACCOUNT_LIMIT`
      (10), `AUTH_RATE_LIMIT_ACCOUNT_WINDOW_SECONDS` (900) e `AUTH_HMAC_SECRET` (obrigatório fora de desenvolvimento e
      teste, mínimo de 32 bytes; R4a), mais `src/infra/auth/hmac-keys.ts` (chaves por finalidade com `hkdfSync`:
      `throttle-account`, `session-public-id`); teste antes em `src/config/env.schema.spec.ts` (padrões, valores
      inválidos, teto menor que a base, segredo curto ou ausente em produção) e `src/infra/auth/hmac-keys.spec.ts`
      (chaves diferentes por finalidade, estáveis para o mesmo segredo); documentar em `.env.example` e em
      `specs/001-transversal-infrastructure/contracts/environment.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema, catálogo da trilha, cálculo da etapa, decorador de etapa e schemas de resposta. Nenhuma user
story começa antes.

- [ ] T004 [P] Teste da migration `test/auth/staff-sign-in.migration.e2e-spec.ts`: colunas `users.lockout_level` e
      `sessions.password_change_failures` com padrão 0 e CHECK (valores fora da faixa recusados), `down()` volta ao
      schema anterior, drift check sem diferenças
- [ ] T005 Migration à mão `src/database/migrations/<ts>-StaffSignIn.ts` e colunas nas entidades `User`
      (`lockoutLevel`) e `Session` (`passwordChangeFailures`) (depois do T004)
- [ ] T006 [P] Catálogo da trilha (teste antes em `src/modules/audit/audit-action.enum.spec.ts` e
      `audit-metadata.schemas.spec.ts`): ação nova `AUTH_PASSWORD_CHANGE_FAILED`
      `{ reason: CURRENT_PASSWORD_INVALID, attempt: 1..5, locked }`; `AUTH_LOGIN_FAILED` `{ reason }` (enum de
      `UNKNOWN_ACCOUNT`, `BAD_CREDENTIALS`, `TEMPORARILY_LOCKED`, `BLOCKED`, `DISABLED`) e `{ locked? }`;
      `AUTH_MFA_ENROLLED` `{ replaced }`; nada de texto livre (senha ou e-mail recusados, inclusive `XQZ`)
- [ ] T007 [P] Teste do mapeamento em `src/infra/auth/auth-audit.subscriber.spec.ts`: `mfa-enabled` →
      `AUTH_MFA_ENROLLED`; `mfa-verified` com `recovery-code` → `AUTH_RECOVERY_CODE_USED` além do `AUTH_SIGNED_IN`
- [ ] T008 Mapeamento no `src/infra/auth/auth-audit.subscriber.ts` (depois do T007)
- [ ] T009 [P] Teste em tabela `src/modules/auth/next-step.spec.ts`: as cinco combinações da R2 (pendente;
      verificada com e sem troca; sem MFA com e sem troca)
- [ ] T010 Cálculo da etapa em `src/modules/auth/next-step.ts` (depois do T009)
- [ ] T011 [P] `StepRoute(etapas)` em `src/common/http/route-decorators.ts` (`Authenticate({ mfa: false })`,
      `@Can.Anyone()` e metadado das etapas aceitas), com teste em `src/common/http/route-decorators.spec.ts`
- [ ] T012 [P] Schemas em `src/modules/auth/auth.schemas.ts` (entrada `strictObject`: credenciais, desafio com
      exatamente um de `code`/`recoveryCode`, confirmação, troca de senha; respostas: `StepResponse`, `Enrollment`,
      `Confirmation`, `OwnSession`, com o JSON Schema para o OpenAPI) e teste `src/modules/auth/auth.schemas.spec.ts`
      (campos extras, os dois códigos juntos ou nenhum, tamanhos, sem ecoar valor)

**Checkpoint**: base pronta.

---

## Phase 3: User Story 1 - Entrar com senha e segundo fator (Priority: P1) 🎯 MVP

**Goal**: entrada com `nextStep` e horários, desafio com 422/423 e recuperação, resposta genérica, bloqueio
progressivo, saída e o fluxo inteiro sem o login de exemplo.

**Independent Test**: fluxo inteiro e casos de erro com respostas, tempos e trilha.

### Tests for User Story 1 ⚠️ (escrever antes, devem falhar)

- [ ] T013 [P] [US1] Unitário `src/modules/auth/credentials.service.spec.ts`: cálculo do bloqueio com a configuração
      (15 min × 2^nível, teto 24 h, limiar 5) e motivo codificado de cada caso
- [ ] T014 [P] [US1] e2e `test/auth/sign-in.e2e-spec.ts`: senha certa → 200 `MFA_REQUIRED` com horários e cookie que
      não abre `GET /me` (401); inexistente, senha errada, `BLOCKED`, `DISABLED` e bloqueio temporário → mesmo corpo
      401 (comparado sem `requestId`); diferença de tempo inexistente × senha errada < 10% (20 de cada, impressa como
      na feature 004); `AUTH_LOGIN_FAILED` com o motivo e sem e-mail; rehash de hash com custo menor; senha e e-mail
      fora de logs e trilha (texto inteiro e `XQZ`)
- [ ] T015 [P] [US1] e2e `test/auth/lockout.e2e-spec.ts` (com `TestClock`): 5 falhas → bloqueio de 15 min (senha certa
      ainda dá 401 genérico); passado o tempo, entra; nova série → 30 min; teto de 24 h; códigos errados no desafio
      somam no mesmo contador; entrada completa zera; 10 falhas simultâneas não passam do limiar (um bloqueio só)
- [ ] T016 [P] [US1] e2e `test/auth/mfa-challenge.e2e-spec.ts`: código válido (passo atual e ±1) → 200 `DONE`, cookie
      novo e o antigo sem valor; código errado ou repetido → 422 `MFA_CODE_INVALID` com a sessão pendente intacta; 5
      errados → 423 `MFA_LOCKED`; código de recuperação (minúsculas e espaços normalizados) vale uma vez e grava
      `AUTH_RECOVERY_CODE_USED`; sem sessão pendente → 401; corpo com os dois códigos ou nenhum → 400; com autenticador
      e troca obrigatória → `PASSWORD_CHANGE_REQUIRED` depois do desafio (Q2); sessão pendente que expira antes do
      desafio (com `TestClock`) → 401 (G2)
- [ ] T017 [P] [US1] e2e `test/auth/full-flow.e2e-spec.ts` (AUTH-06): entrada, desafio, `GET /me` 200, saída 204 com
      cookie apagado, `GET /me` 401; saída também com sessão pendente; atributos do cookie de cada resposta que o
      define (`__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, G2); nada do login de exemplo importado

### Implementation for User Story 1

- [ ] T018 [US1] Contadores atômicos em `src/modules/users/users.repository.ts`: `registerLoginFailure(id, config,
now)` (incremento e bloqueio numa instrução, `RETURNING`), `resetLoginFailures(id)`, `updatePasswordHash`
- [ ] T019 [US1] `CredentialsService` em `src/modules/auth/credentials.service.ts` (promovido do
      `ExampleCredentials`): hash sempre verificado antes de status e bloqueio, motivo na trilha, falha registrada,
      rehash (R3)
- [ ] T020 [US1] `AuthController` em `src/modules/auth/auth.controller.ts` (`@AdminApi('auth')`):
      `POST /auth/sign-in`, `POST /auth/mfa/challenge` (422/423 pela contagem de falhas recentes, R9; falha soma no
      contador de login) e `POST /auth/sign-out` (`OpenAdminRoute()`); respostas com `nextStep` e horários; zerar o
      contador na entrada completa; registro no `src/modules/auth/auth.module.ts`
- [ ] T021 [US1] Trocar o login de exemplo pelas rotas definitivas nos testes: `test/users/support.ts`,
      `test/contract/auth/example/auth-helpers.ts`, `test/contract/auth/sign-in-mfa.e2e-spec.ts`,
      `session-expiry.e2e-spec.ts`, `integration.e2e-spec.ts` e `test/users/last-login.e2e-spec.ts`; remover
      `ExampleAuthController` e `ExampleCredentials` (fica só a parte de autorização do exemplo, R1); suíte inteira
      verde

**Checkpoint**: login real funcionando; features seguintes entram pelas rotas definitivas.

---

## Phase 4: User Story 3 - Trocar a senha (Priority: P1)

**Goal**: troca com 422 por código, limite de 5 erros, encerramento das outras sessões e a regra R11.

**Independent Test**: troca com outra sessão aberta; 5 erros de senha atual; rotas com troca pendente.

### Tests for User Story 3 ⚠️

- [ ] T022 [P] [US3] e2e `test/auth/password-change.e2e-spec.ts`: sucesso → 200 com `nextStep`, horários, cookie novo,
      outra sessão da pessoa cai, `AUTH_PASSWORD_CHANGED`; curta, comum e igual à atual → 422 com
      `PASSWORD_TOO_SHORT`, `PASSWORD_COMMON`, `PASSWORD_SAME_AS_CURRENT` (não contam); senha atual errada 1 a 4 →
      422 `CURRENT_PASSWORD_INVALID` com `AUTH_PASSWORD_CHANGE_FAILED` (`attempt` 1..4, `locked: false`); 5º → 429,
      sessão apagada, cookie apagado, mesmo cookie 401, registro `locked: true`; 5 simultâneos → sessão encerrada uma
      vez; sessão nova começa do zero; senha (inteira e `XQZ`) fora de resposta, logs e trilha
- [ ] T023 [P] [US3] e2e `test/auth/password-change-gate.e2e-spec.ts` (R11): pessoa com autenticador e troca
      obrigatória, depois do desafio → `GET /users` (como ADMIN) e outras rotas dão 403 `PASSWORD_CHANGE_REQUIRED`; `GET
  /me` 200 com `passwordChangeRequired: true`; `sign-out` funciona; depois da troca, tudo volta; e teste
      `test/auth/route-walk.e2e-spec.ts` que percorre **todas** as rotas administrativas registradas no roteador
      (SC-004, G1): com sessão pendente, 401 em todas exceto `mfa/challenge` e `sign-out`; com troca pendente e sessão
      verificada, 403 `PASSWORD_CHANGE_REQUIRED` em todas exceto `PUT /me/password`, `sign-out` e `GET /me`; rota de
      etapa fora da etapa → 403 `STEP_NOT_ALLOWED` (I1)

### Implementation for User Story 3

- [ ] T024 [US3] Contador em `src/infra/auth/stores/pg-session.store.ts`: `registerPasswordChangeFailure(sessionId)`
      com `UPDATE` condicional e `RETURNING` (R6)
- [ ] T025 [US3] `PasswordChangeService` em `src/modules/auth/password-change.service.ts`: política e
      `PASSWORD_SAME_AS_CURRENT` (códigos novos mapeados em `src/modules/auth/password/password-policy.ts`), contador
      e encerramento no 5º erro, hash fora da transação, troca + `AUTH_PASSWORD_CHANGED` na transação, `revokeAll`
      com `except` e `rotate` depois (R6, R7)
- [ ] T026 [US3] `PUT /me/password` em `src/modules/auth/me-security.controller.ts` (`StepRoute` em
      `PASSWORD_CHANGE_REQUIRED` e `DONE`)
- [ ] T027 [US3] Guard `src/infra/auth/password-change-gate.guard.ts` (depois do guard de identidade, no
      `AdminAreaGuardModule`): 403 `PASSWORD_CHANGE_REQUIRED` com sessão verificada e troca pendente, exceto
      `PUT /me/password`, `sign-out` e `GET /me` (R11)

**Checkpoint**: troca de senha completa.

---

## Phase 5: User Story 2 - Primeiro acesso (Priority: P1)

**Goal**: troca da senha provisória e cadastro do autenticador com QR code PNG e códigos de recuperação.

**Independent Test**: pessoa criada pelo `POST /users` até `DONE`.

### Tests for User Story 2 ⚠️

- [ ] T028 [P] [US2] Unitário `src/modules/auth/qr-png.spec.ts`: PNG com assinatura, IHDR e CRC válidos, dimensões
      pela escala e margem, matriz lida de volta igual à do `uqr`; URI com caracteres especiais
- [ ] T029 [P] [US2] e2e `test/auth/first-access.e2e-spec.ts`: pessoa do `POST /users` → `PASSWORD_CHANGE_REQUIRED` →
      troca → `MFA_ENROLLMENT_REQUIRED` → cadastro (`otpauthUri`, `qrCodeDataUri` PNG decodificável, `secret`) →
      confirmação com código errado 422 `MFA_CODE_INVALID` (cadastro continua) → confirmação certa: 10 códigos, `DONE`,
      cookie novo, `AUTH_MFA_ENROLLED`; antes de `DONE`, `GET /me` e `GET /users` dão 401; cadastro fora da etapa → 403
      `STEP_NOT_ALLOWED` (I1); conta bloqueada pelo Administrador no meio do primeiro acesso → 401 na etapa seguinte
      (G2); segundo pedido de cadastro substitui o primeiro; segredo, QR e códigos fora de logs e trilha; depois do
      reset do MFA (feature 005), a entrada volta a `MFA_ENROLLMENT_REQUIRED`

### Implementation for User Story 2

- [ ] T030 [P] [US2] `src/modules/auth/qr-png.ts`: matriz do `uqr` → PNG 1 bit com `node:zlib` (`deflateSync`,
      `crc32`) → `data:image/png;base64,…` (R5)
- [ ] T031 [US2] `MfaEnrollmentService` em `src/modules/auth/mfa-enrollment.service.ts` e rotas
      `POST /auth/mfa/enrollment` e `/enrollment/confirmation` no `AuthController` (`StepRoute` em
      `MFA_ENROLLMENT_REQUIRED`; `MfaService.enroll`, `SignInService.confirmMfa`, `generateRecoveryCodes`; R8)

**Checkpoint**: P1 completa.

---

## Phase 6: User Story 4 - Ver e encerrar as próprias sessões (Priority: P2)

### Tests for User Story 4 ⚠️

- [ ] T032 [P] [US4] e2e `test/auth/own-sessions.e2e-spec.ts`: duas sessões listadas com criação, último uso, IP,
      navegador e a atual marcada, sem o id do cookie nem o id interno; encerrar a outra (204) e ela cai; id de sessão
      de outra pessoa → 404; `DELETE /me/sessions` encerra todas (cookie apagado, `AUTH_SESSION_REVOKED`); sessão
      pendente → 401

### Implementation for User Story 4

- [ ] T033 [US4] `OwnSessionsService` em `src/modules/auth/own-sessions.service.ts` (id público por HMAC com a chave
      `session-public-id`, R4a e R13) e rotas `GET /me/sessions`, `DELETE /me/sessions/:id`, `DELETE /me/sessions` no
      `me-security.controller.ts`

---

## Phase 7: User Story 5 - Proteções do navegador e limite de tentativas (Priority: P2)

### Tests for User Story 5 ⚠️

- [ ] T034 [P] [US5] e2e `test/auth/origin-protection.e2e-spec.ts`: `POST` administrativo com `Origin` de fora → 403;
      com `Sec-Fetch-Site: cross-site` → 403; mesma origem e cliente sem `Origin` → aceitos; origem do backoffice
      recebe CORS com credenciais; outra origem não
- [ ] T035 [P] [US5] e2e `test/auth/rate-limit.e2e-spec.ts`: 21 entradas do mesmo IP em 1 min → 429 com
      `Retry-After`; 11 para a mesma conta em 15 min → 429, igual para e-mail existente e inexistente; desafio com o
      mesmo limite por pessoa; números trocados por ambiente valem; chave no Redis sem o e-mail em claro; duas
      instâncias da API somam o mesmo contador
- [ ] T036 [P] [US5] Teste do storage `test/infra/redis-throttler.storage.e2e-spec.ts`: incremento e expiração
      atômicos, `timeToExpire` correto, concorrência

### Implementation for User Story 5

- [ ] T037 [US5] `src/infra/throttle/redis-throttler.storage.ts` (script atômico `INCR` + `PEXPIRE`) e módulo do
      throttler com os números do ambiente; guard nas rotas `sign-in` e `mfa/challenge` com chaves por IP e por conta
      (HMAC com a chave `throttle-account`, R4 e R4a)
- [ ] T038 [US5] `app.enableCsrfProtection({ trustedOrigins: CORS_ORIGINS })` em `src/app.setup.ts` (R10)

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T039 [P] Teste de contrato `test/openapi/auth-contract.e2e-spec.ts` (R12): rotas, schemas de sucesso, status de
      erro e códigos do `openapi/admin.json` conferidos contra o `auth-api.md` do front (só leitura; pulado sem o
      repositório): o que o front lista existe no OpenAPI; status a mais só os da lista explícita do teste (400, 403 de
      origem, 403 `PASSWORD_CHANGE_REQUIRED`, 403 `STEP_NOT_ALLOWED`, 429 no desafio; C1); `@ApiOkResponse` e respostas
      de erro documentadas nas rotas; e2e validam as respostas reais contra os schemas
- [ ] T040 `npm run openapi:export` e commit de `openapi/`
- [ ] T041 [P] Regras no `AGENTS.md`: rotas de etapa só com `StepRoute`; 401 só para sessão ausente ou expirada;
      números de bloqueio e limite só pelo ambiente; testes entram pelas rotas definitivas; e premissa do front no ADR
      0053 ("O que já existe"): proxy repassa o `Host` e não reescreve a origem
- [ ] T042 [P] Backlog: marcar os critérios atendidos do AUTH-01 a AUTH-08 em `docs/tarefas/04-auth.md` e o critério
      aberto do USERS-02 em `docs/tarefas/03-users.md`; atualizar a seção "O que já existe" do ADR 0053
- [ ] T043 Cobertura mínima de 80% em `src/modules/auth` e `src/infra/throttle` no `vitest.config.coverage.ts`
- [ ] T044 Rodar os cenários do `quickstart.md`, a suíte completa (lint, typecheck, unitários, e2e, build, openapi em
      dia, cada um separado), o compose `--profile app` (credencial errada → 401 genérico; `Origin` estranho → 403),
      Trivy e gitleaks

---

## Dependencies & Execution Order

- **Setup (T001–T003)**: T001 antes de qualquer código; T002 e T003 em paralelo.
- **Foundational (T004–T012)**: depois do Setup; bloqueia as histórias. Pares teste → implementação: T004→T005,
  T007→T008, T009→T010.
- **US1 (T013–T021)**: depois da Foundational; T021 (troca do login de exemplo) fecha a fase e destrava as demais.
- **US3 (T022–T027)**: depois da US1. **US2 (T028–T031)**: depois da US3 (usa a troca de senha).
- **US4 (T032–T033)** e **US5 (T034–T038)**: depois da US1; independentes entre si e da US2/US3.
- **Polish (T039–T044)**: depois das histórias desejadas.

## Parallel Opportunities

- Setup: T002 e T003.
- Foundational: T004, T006, T007, T009, T011 e T012 juntos; depois T005, T008, T010.
- US1: T013 a T017 juntos.
- US3: T022 e T023 juntos. US2: T028, T029 e T030 juntos.
- US4 e US5 em paralelo depois da US1 (T032, T034, T035 e T036 juntos).
- Polish: T039, T041 e T042.

### Parallel Example: User Story 1

```text
Task: "T014 e2e da entrada com resposta genérica e tempo"
Task: "T015 e2e do bloqueio progressivo"
Task: "T016 e2e do desafio"
Task: "T017 e2e do fluxo inteiro"
```

## Implementation Strategy

### MVP First

1. Setup + Foundational.
2. US1 (entrada, desafio, saída) → validar sozinha: quem já tem autenticador entra no backoffice.
3. Parar e validar; o front integra a entrada.

### Incremental Delivery

1. US1 → MVP.
2. US3 + US2 → troca de senha e primeiro acesso (fecha a P1; novas pessoas conseguem entrar).
3. US4 e US5 → sessões e proteções.
4. Polish (contrato do front, backlog, cobertura).

## Notes

- Commits locais por fase/história na implementação, Conventional Commits, sem `--no-verify`, sem push.
- Nunca `down -v` no Postgres local. Nunca abrir arquivo para escrita antes de ler.
- Nada de `test/` importado por `src/`.
