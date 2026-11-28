# Tasks: Gestão da equipe interna e meu perfil

**Input**: Design documents from `specs/005-team-user-management/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: obrigatórios para toda regra de segurança, privacidade, permissão e auditoria (constituição, princípio VII).
Escreva cada teste antes da implementação, com entradas curtas e casos de borda, e confirme que falha. Os e2e usam
`createTestApp({ vault: 'api' })` e sessões reais pelo login de exemplo da feature 004 (`test/contract/auth/example/`,
só de teste); horários com `TestClock` no `AUTH_CLOCK`; "não vazou" também com trecho curto (`XQZ`).

**Organization**: por user story (US1 a US4 da spec). Nenhuma migration.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: US1 a US4 da spec

---

## Phase 1: Setup

**Purpose**: decisões registradas antes do código (princípio IX).

- [x] T001 Registrar em `docs/adr/README.md`, depois da última linha existente (conferir o arquivo antes; o front pode
      ter registrado algo e a numeração segue a que estiver livre): D55 (catálogo único de habilidades `recurso.ação`
      em `src/modules/access-control/abilities.ts`, fonte do `/me` e das políticas, catálogo completo da matriz do
      ACL-01 já na feature 005, formato `^[a-z][a-z-]*\.[a-z][a-z-]*$` validado também pelo front, código novo é
      aditivo e renomear ou remover é incompatível, testes de concordância; research R1) e D56 (corpo de erro com
      `code` e `details` opcionais, `details` só com inteiros e enums; research R8). Sem mexer em linhas de outros
      (conferir com `git diff -w`)
- [x] T002 [P] Registrar no CASE-03 de `docs/tarefas/09-case-management.md` a premissa da feature 005: a atribuição
      trava a linha do analista (`FOR SHARE`) e recusa quem não está ativo ou não é Analista, para não escapar da regra
      de desativação (research R4); e no ACL-01 de `docs/tarefas/05-access-control.md` que o catálogo de códigos já
      existe (D55) e as políticas usam os mesmos códigos

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: catálogo de habilidades, política da área de usuários, corpo de erro com código, schemas e apoio de
teste. Nenhuma user story começa antes.

- [x] T003 [P] Teste unitário `src/modules/access-control/abilities.spec.ts`: tabela perfil × código com o esperado da
      matriz do ACL-01 (12 códigos, research R1); combinação de perfis = união; lista ordenada e sem repetição; perfil
      vazio = lista vazia; todo código casa com `^[a-z][a-z-]*\.[a-z][a-z-]*$`; e teste de documento que lê a tabela da
      matriz em `docs/tarefas/05-access-control.md` (mapa rótulo da linha → códigos no próprio teste) e falha se uma
      linha ou marcação mudar sem o catálogo mudar
- [x] T004 Catálogo em `src/modules/access-control/abilities.ts`: tipo `Ability` (união dos 12 códigos),
      `ABILITY_CATALOG` (perfis e escopo global/por registro), `abilitiesFor(roles)` e `hasAbility(user, code)`
      (depois do T003)
- [x] T005 [P] Teste `src/common/http/http-exception.filter.spec.ts`: exceção de domínio com `code` e `details` sai
      no corpo; `details` com valor que não seja inteiro ou enum é recusado na construção; erros existentes continuam
      sem `code`; mensagem nunca repete valor recebido
- [x] T006 `code?` e `details?` em `src/common/http/api-error.ts`, classe `DomainConflictError` (409 com código) em
      `src/common/http/domain-error.ts` e repasse no `src/common/http/http-exception.filter.ts`;
      `EmailAlreadyRegisteredError` de `src/modules/users/users.repository.ts` passa a levar `EMAIL_ALREADY_REGISTERED`
      (depois do T005)
- [x] T007 [P] Teste unitário `src/modules/access-control/policies/users.policy.spec.ts`: `manage` só com
      `users.manage`; `actOnOther` nega quando o alvo é a própria pessoa (mesmo sendo ADMIN) e quando falta
      `users.manage`; id malformado não passa
- [x] T008 `UsersPolicy` em `src/modules/access-control/policies/users.policy.ts` (habilidades `manage` e
      `actOnOther`, consultando `hasAbility`), registrada e exportada pelo
      `src/modules/access-control/access-control.module.ts` (depois do T004 e T007)
- [x] T009 [P] Schemas da trilha (teste antes em `src/modules/audit/audit-metadata.schemas.spec.ts`): `USER_UPDATED` =
      `{ fields: ['name'] }` (enum, nunca valor); `USER_CREATED.forced` opcional; `USER_MFA_RESET` sem metadata, em
      `src/modules/audit/audit-metadata.schemas.ts`
- [x] T010 [P] Chave do advisory lock em `src/modules/users/admin-lock.ts` (mesmo valor de hoje) e
      `src/cli/create-admin.command.ts` passando a importá-la; `test/cli/create-admin.e2e-spec.ts` continua verde
- [x] T011 [P] Schemas de entrada e saída em `src/modules/users/users.schemas.ts` (`strictObject`, `text({ max: 120 })`
      para nome, e-mail normalizado com até 254 caracteres, perfis 1 a 5 sem repetição, status, filtro da listagem com
      `pageQueryShape`) e teste `src/modules/users/users.schemas.spec.ts` (campos extras, perfil repetido, vazio,
      inexistente, nome só com espaços, e-mail inválido: 400 sem ecoar valor)
- [x] T012 [P] Apoio de teste `test/users/support.ts`: cria pessoas da equipe com perfis e devolve o cookie de sessão
      verificada pelo login de exemplo da 004 (reusa `test/contract/auth/example/auth-helpers.ts`); app com
      `ExampleAuthModule` e `TestClock`

**Checkpoint**: catálogo, política, erro com código e apoio de teste prontos.

---

## Phase 3: User Story 1 - Cadastrar e consultar a equipe (Priority: P1) 🎯 MVP

**Goal**: o Administrador cadastra com senha provisória exibida uma vez, lista e detalha a equipe.

**Independent Test**: criar, listar e detalhar com sessão de Administrador; conferir trilha e logs.

### Tests for User Story 1 ⚠️ (escrever antes, devem falhar)

- [x] T013 [P] [US1] Teste unitário `src/modules/users/temporary-password.spec.ts`: 20 caracteres do alfabeto sem
      ambíguos, passa no `checkPasswordPolicy`, 1.000 gerações sem repetição
- [x] T014 [P] [US1] e2e `test/users/users-create-list.e2e-spec.ts`: 201 com `temporaryPassword` e pessoa ativa, sem
      MFA, `passwordChangeRequired: true`; o hash guardado verifica a senha provisória; detalhe e listagem nunca trazem
      a senha, hash, segredo ou códigos; e-mail repetido com outra caixa e espaços → 409 `EMAIL_ALREADY_REGISTERED`;
      `USER_CREATED` com ator Administrador e metadata só `{ roles }`; senha provisória e e-mail ausentes de logs e
      trilha (texto inteiro e trecho curto), inclusive no 409; 30 pessoas → filtro por status e perfil e páginas de 10
      por cursor; cursor adulterado → 400; Analista, DPO e Auditor → 403 com `ACCESS_DENIED`; sem sessão → 401; id
      inexistente → 404, malformado → 400
- [x] T015 [P] [US1] e2e `test/users/last-login.e2e-spec.ts`: `lastLoginAt` nulo antes; preenchido depois de senha e
      MFA (com `TestClock`); não muda só com a senha (MFA pendente)

### Implementation for User Story 1

- [x] T016 [P] [US1] Gerador em `src/modules/users/temporary-password.ts` (`crypto.randomInt`, research R5)
- [x] T017 [US1] Repositório `src/modules/users/users.repository.ts`: `listPage(filtros, page)` com `paginate()` e
      `findStaffById` (perfis, `mfaEnabledAt`, `passwordChangedAt`, `lastLoginAt`, sem colunas sensíveis)
- [x] T018 [US1] `UsersService.create/list/get` em `src/modules/users/users.service.ts`: hash antes da transação;
      `createWithRoles` + `USER_CREATED` na mesma transação; mapeamento para `StaffUser` (contracts/users-api.md)
- [x] T019 [US1] `UsersController` em `src/modules/users/users.controller.ts` (`@AdminApi('users')`, `POST /users`,
      `GET /users`, `GET /users/:id` com `@Can(UsersPolicy, 'manage')`), registrado no
      `src/modules/users/users.module.ts`
- [x] T020 [P] [US1] Assinante `src/modules/users/last-login.subscriber.ts` (eventos `mfa-verified` e `sign-in` com
      senha sem MFA pendente → `users.last_login_at`; erro logado só pelo nome), registrado no `users.module.ts`

**Checkpoint**: US1 funcional e testada sozinha.

---

## Phase 4: User Story 2 - Meu perfil para o backoffice (Priority: P1)

**Goal**: `GET /me` no formato do `CurrentUser` do front, com habilidades do catálogo e horários de expiração.

**Independent Test**: entrar com cada perfil e comparar `abilities` e horários.

### Tests for User Story 2 ⚠️

- [x] T021 [P] [US2] e2e `test/users/me.e2e-spec.ts`: campos e tipos exatamente os de `contracts/me-api.md`
      (nenhum campo a mais, nenhum sensível); `abilities` de cada um dos 5 perfis e de ADMIN+ANALYST igual ao catálogo;
      perfil retirado reflete na requisição seguinte; com `TestClock` (sessão às 12:00, uso às 12:10):
      `idleExpiresAt` ≤ 12:25 e ≥ 12:24, `absoluteExpiresAt` = 20:00, ambos ISO 8601 UTC; nenhuma linha nova na
      trilha depois de consultar o perfil; sem sessão → 401; pessoa desativada → 401
- [x] T022 [P] [US2] e2e de concordância `test/users/abilities-concordance.e2e-spec.ts`: para cada perfil,
      `users.manage` no `/me` ⇔ 200 em `GET /users`; `audit.read` ⇔ 200 em `GET /audit-logs`

### Implementation for User Story 2

- [x] T023 [US2] `MeController` em `src/modules/users/me.controller.ts` (`@AdminApi('me')`, `@Can.Anyone()`,
      `@CurrentSession()` para `lastActiveAt` + 15 min e `expiresAt`), registrado no `users.module.ts`
- [x] T024 [US2] `src/modules/audit/audit.controller.ts`: checagem do Auditor via `hasAbility(user, 'audit.read')`, com
      o mesmo `ACCESS_DENIED` de hoje (`test/audit/` continua verde)

**Checkpoint**: US1 e US2 independentes; o front pode integrar o `/me`.

---

## Phase 5: User Story 3 - Alterar dados, status e perfis com segregação (Priority: P1)

**Goal**: nome, status e perfis com corte imediato de acesso, D21, último Administrador e denúncias atribuídas (Q1).

**Independent Test**: bloquear uma pessoa com sessão aberta e conferir 401; tentar agir sobre si; zerar Administradores
com operações simultâneas.

### Tests for User Story 3 ⚠️

- [x] T025 [P] [US3] e2e `test/users/users-status.e2e-spec.ts`: bloquear e desativar → a pessoa recebe 401 na
      requisição seguinte e não sobra sessão dela no banco; reativar → entra de novo e o cookie antigo continua 401;
      mesmo status → 200 sem registro; mudar o próprio status → 403 com `ACCESS_DENIED`; os dois únicos
      Administradores bloqueando um ao outro ao mesmo tempo → só um passa, o outro 403 ou 409, e sobra um ativo
      (repetir 5 vezes); Administrador bloqueado enquanto a requisição dele está em andamento não aplica a mudança
      (403, nada muda); Analista com denúncia aberta atribuída → `DISABLED` dá 409 `USER_HAS_ASSIGNED_REPORTS` com
      `details.assignedReports` exato, `BLOCKED` funciona; denúncia encerrada atribuída não impede;
      `USER_STATUS_CHANGED` com `{ from, to }` e ator Administrador
- [x] T026 [P] [US3] e2e `test/users/users-roles-name.e2e-spec.ts`: trocar os próprios perfis → 403; ADMIN acumula
      perfil que lê denúncias concedido por outro → 200 (D21); duas retiradas simultâneas de ADMIN entre os dois
      últimos → só uma passa e sobra um ativo; Administrador que perdeu o perfil no meio da requisição → 403; retirar
      ANALYST com denúncia aberta → 409 com a quantidade; mesmo conjunto → 200 sem registro; mudança vale na requisição
      seguinte; `USER_ROLES_CHANGED` com `{ before, after }`; alterar nome → `USER_UPDATED` com `{ fields: ['name'] }`
      e sem o nome na trilha; nome com campos extras → 400; e teste de integração
      `test/users/last-active-admin.e2e-spec.ts` chamando o `UsersService` direto: retirar o perfil, bloquear ou
      desativar o último Administrador ativo → 409 `LAST_ACTIVE_ADMIN` e nada muda (FR-011)

### Implementation for User Story 3

- [x] T027 [US3] Repositório `src/modules/users/users.repository.ts`: `lockPair(actorId, targetId, manager)` (as duas
      linhas numa só consulta, em ordem de id, `FOR UPDATE`), `countOpenAssignedReports(id, manager)` (status fora de
      `CONCLUDED`, `INVALID`, `ARCHIVED`), `updateName`, `updateStatus`, `replaceRoles` (todos com o `EntityManager` da
      transação)
- [x] T028 [US3] `UsersService.updateName/changeStatus/changeRoles` em `src/modules/users/users.service.ts`: transação
      com `pg_advisory_xact_lock` (chave do T010) quando pode reduzir Administradores, `lockPair`, nova conferência de
      quem age (ativo e Administrador, senão 403, FR-011a), contagem de atribuídas (Q1), contagem de Administradores
      depois da mudança (R3), auditoria na mesma transação; `SessionService.revokeAll` depois do commit ao sair de
      `ACTIVE` e antes da transação ao voltar (R2)
- [x] T029 [US3] Rotas em `src/modules/users/users.controller.ts`: `PATCH /users/:id` (`manage`),
      `PUT /users/:id/status` e `PUT /users/:id/roles` (`actOnOther` com o id do caminho)

**Checkpoint**: P1 completa.

---

## Phase 6: User Story 4 - Resetar o MFA de outra pessoa (Priority: P2)

**Goal**: apagar autenticador e códigos de outra pessoa, derrubar as sessões e registrar.

**Independent Test**: reset de uma pessoa com MFA e sessão aberta.

### Tests for User Story 4 ⚠️

- [x] T030 [P] [US4] Caso novo em `test/contract/auth/pg-mfa-store.e2e-spec.ts`: `resetFor` dentro de uma transação
      apaga segredo, segredo pendente, último passo, `mfa_enabled_at` e códigos; com rollback nada muda; nenhuma chamada
      ao Vault
- [x] T031 [P] [US4] e2e `test/users/users-mfa-reset.e2e-spec.ts`: 204; autenticador e códigos somem; a sessão da
      pessoa cai (401); `USER_MFA_RESET` com ator Administrador; reset do próprio MFA → 403; pessoa sem MFA → 204 e
      registro; outro perfil → 403; inexistente → 404; Administrador bloqueado no meio da requisição → 403

### Implementation for User Story 4

- [x] T032 [US4] `resetFor(userId, manager)` em `src/infra/auth/stores/pg-mfa.store.ts` (mesmas colunas de
      `saveTotp(null)` + `DELETE` dos códigos, research R6)
- [x] T033 [US4] `UsersService.resetMfa` e rota `POST /users/:id/mfa-reset` (`actOnOther`) em
      `src/modules/users/users.service.ts` e `src/modules/users/users.controller.ts` (`lockPair` e conferência de quem
      age, como no T028); `revokeAll` depois do commit

**Checkpoint**: todas as histórias independentes e testadas.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T034 `npm run openapi:export` e commit de `openapi/admin.json`; conferir o schema do `/me` contra o `CurrentUser`
      de `../canal-denuncias-web/specs/004-backoffice-sign-in/contracts/auth-api.md` (só leitura)
- [x] T035 [P] Regras novas no `AGENTS.md`: habilidade nova só no catálogo `abilities.ts` (D55) e política consulta
      `hasAbility`; erro de regra de negócio com `DomainConflictError` e `code` estável (D56); operação que reduz
      Administradores usa o lock de `admin-lock.ts`; e ajuste da regra de testes: rotas com política e sessão real (como
      as da feature 005) usam o login de exemplo da 004 (`test/contract/auth/example/`), não
      `createTestApp({ identity: true })`
- [x] T036 [P] Backlog: marcar os critérios atendidos do USERS-02 a USERS-07 em `docs/tarefas/03-users.md` (com
      "feature 005"), deixando abertos os que dependem do AUTH-03/AUTH-05 (troca obrigatória e cadastro do MFA no
      primeiro login são aplicados lá)
- [x] T037 Cobertura mínima de 80% em `src/modules/users` e `src/modules/access-control` no
      `vitest.config.coverage.ts`
- [x] T038 Rodar os cenários de `quickstart.md`, a suíte completa (lint, typecheck, unitários, e2e, build, openapi em
      dia, cada um separado), o compose `--profile app` (`GET /api/admin/v1/me` e `/users` → 401 sem sessão), Trivy e
      gitleaks

---

## Dependencies & Execution Order

- **Setup (T001–T002)**: sem dependências; T001 antes de qualquer código (princípio IX).
- **Foundational (T003–T012)**: depois do Setup; bloqueia todas as histórias. Pares teste → implementação: T003→T004,
  T005→T006, T007→T008 (T008 também depende do T004).
- **US1 (T013–T020)**: depois da Foundational. **US2 (T021–T024)**: depois da Foundational; independente da US1 (o `/me`
  não usa as rotas de equipe; o T022 usa `GET /users`, então roda depois do T019). **US3 (T025–T029)**: depois da US1
  (reaproveita controller, service e repositório). **US4 (T030–T033)**: depois da US3 (reusa `lockPair`).
- **Polish (T034–T038)**: depois das histórias desejadas.
- Dentro de cada história: testes primeiro (devem falhar), depois repositório → serviço → rota.

## Parallel Opportunities

- Setup: T002 com T001.
- Foundational: T003, T005, T007, T009, T010, T011 e T012 em paralelo (arquivos diferentes); depois T004, T006, T008.
- US1: T013, T014 e T015 juntos; T016 e T020 em paralelo com T017.
- US2: T021 e T022 juntos.
- US3: T025 e T026 juntos.
- US4: T030 e T031 juntos. US2 pode andar em paralelo com a US3 depois da US1.
- Polish: T035 e T036 em paralelo.

### Parallel Example: User Story 1

```text
Task: "T013 Teste unitário do gerador de senha provisória"
Task: "T014 e2e de cadastro e listagem"
Task: "T015 e2e do último login"
```

## Implementation Strategy

### MVP First

1. Setup + Foundational.
2. US1 (cadastro e consulta) e US2 (`/me`, que destrava o front) → validar sozinhas.
3. Parar e validar; o front pode integrar o `/me` aqui.

### Incremental Delivery

1. US1 + US2 → MVP (equipe cadastrada, front com `/me`).
2. US3 → segregação e corte de acesso (fecha a P1).
3. US4 → reset do MFA.
4. Polish.

## Notes

- Commits locais por fase/história na implementação, Conventional Commits, sem `--no-verify`, sem push.
- Nunca `down -v` no Postgres local.
- Nada de `test/` importado por `src/` (teste de convenção).
