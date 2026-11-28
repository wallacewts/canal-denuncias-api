---
description: 'Lista de tarefas da feature 001: infraestrutura transversal da API'
---

# Tasks: Infraestrutura transversal da API

**Input**: Design documents from `specs/001-transversal-infrastructure/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: obrigatórios para toda regra de privacidade, segurança, permissão, criptografia ou auditoria (constituição,
princípio VII), e pedidos explicitamente pelos critérios de aceite das tarefas TRV. Em cada user story, os testes vêm
**antes** da implementação e precisam **falhar** antes de ela começar.

**Organization**: tarefas agrupadas por user story (US1 a US12 da spec), para que cada uma seja implementada e
testada de forma independente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: user story da spec (US1 a US12)
- Toda tarefa cita o caminho exato do arquivo

## Path Conventions

Projeto único (API NestJS, ESM): código em `src/`, testes unitários ao lado do código (`*.spec.ts`), testes de
integração em `test/` (`*.e2e-spec.ts`). Imports relativos terminam em `.js`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: decisões registradas, dependências e configuração base.

- [x] T001 Registrar D27 a D33 em `docs/adr/README.md` (validação com zod, cliente próprio do Vault, storage com AWS
      SDK, job schedulers do BullMQ, CLI com nest-commander, hash scrypt do `@nestjs/authentication` e escopo da
      TRV-09), marcar a D03 como alterada pela D32 e atualizar a linha "Validação" e "Autenticação" das bibliotecas
      no `README.md`
- [x] T002 Instalar `@nestjs/bullmq@12.0.2`, `bullmq@6.7.10`, `@aws-sdk/client-s3@3.1179.0`,
      `@aws-sdk/lib-storage@3.1179.0`, `nest-commander@3.21.0` e `@nestjs/authentication@0.1.8` (versão exata, sem
      `^`) em `package.json`, e regenerar `package-lock.json` com o npm da imagem `node:26-alpine` (como no esqueleto)
- [x] T003 [P] Acrescentar ao `.env.example` as variáveis de `contracts/environment.md` (`VAULT_ROLE_ID`,
      `VAULT_SECRET_ID`, `VAULT_TIMEOUT_MS`, `S3_FORCE_PATH_STYLE`, `SMTP_*`, `SESSION_SECRET`,
      `REPORTER_TOKEN_SECRET`, `PASSWORD_HASH_LOG_N`, `MAX_ATTACHMENT_BYTES`, `TEST_ADMIN_DATABASE_URL`) com valores
      de desenvolvimento
- [x] T004 [P] Acrescentar ao serviço `api` do `docker-compose.yml` as variáveis novas (Redis, Vault, S3, SMTP,
      ClamAV e segredos de desenvolvimento). _Feito: o `vault-init` de dev também cria o AppRole `api` com IDs
      fixos e a política mínima `docker/vault/api-dev-policy.hcl` (sem `identity-kek`), porque o `api` do compose roda
      com `NODE_ENV=production`, e a US3 passa a exigir AppRole nesse modo._
- [x] T005 [P] Configurar `vitest.config.e2e.ts` com `globalSetup: ['test/support/global-setup.ts']` e timeout de
      teste adequado a integração (30 s). _Feito: timeouts configurados; a linha `globalSetup` entra junto com o arquivo na T009, para não quebrar os
      testes e2e antes de ele existir._

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: setup compartilhado do app e harness de testes de integração, usados pelos testes de todas as user
stories.

**⚠️ CRITICAL**: nenhuma user story começa antes desta fase.

- [x] T006 Extrair de `src/main.ts` a configuração do app (prefixo `api` com exclusão de health, helmet, CORS,
      `trust proxy`, shutdown hooks e Swagger fora de produção) para `setupApp(app)` em `src/app.setup.ts`, e fazer
      `src/main.ts` usá-la
- [x] T007 Permitir destino de log injetável em `src/config/logger.config.ts` (parâmetro opcional `DestinationStream`),
      mantendo os serializers que descartam IP, cabeçalhos e query string
- [x] T008 [P] Criar `test/support/log-capture.ts`: stream em memória que guarda as linhas JSON de log e permite
      filtrar por `req.id`
- [x] T009 [P] Criar `test/support/global-setup.ts` e registrá-lo em `globalSetup` no `vitest.config.e2e.ts`: com `TEST_ADMIN_DATABASE_URL`, recriar `canal_test_template`,
      rodar as migrations nele com o data source da CLI e garantir os perfis `app_migrator` e `app_runtime`
- [x] T010 [P] Criar `test/support/test-database.ts`: `createSuiteDatabase()` com
      `CREATE DATABASE canal_test_<id> TEMPLATE canal_test_template` e `dropSuiteDatabase()` no fim da suíte
- [x] T011 Criar `test/support/test-app.ts`: `createTestApp({ imports })` que sobe o `AppModule` com `setupApp`, o
      banco da suíte (perfil `app_runtime`), a captura de log e módulos de fixture opcionais, e devolve
      `{ app, logs, close }`
- [x] T012 Migrar `test/health.e2e-spec.ts` para `createTestApp` (prova que o harness funciona)
- [x] T013 Passar `TEST_ADMIN_DATABASE_URL` (superusuário do serviço Postgres) e os segredos de teste ao job `e2e` em
      `.github/workflows/ci.yml`

**Checkpoint**: harness pronto. As user stories podem começar.

---

## Phase 3: User Story 1 - Erros que nunca vazam dados (Priority: P1) 🎯 MVP

**Goal**: todo erro no formato `{ statusCode, error, message, requestId }`, sem dado de entrada (TRV-01).

**Independent Test**: provocar 400, 401, 403, 404, 409 e 500 por rotas de fixture e conferir o corpo e as linhas de
log capturadas.

### Tests for User Story 1 (mandatory for security and privacy rules) ⚠️

- [ ] T014 [P] [US1] Teste unitário em `src/common/http/http-exception.filter.spec.ts`: formato para 400, 401, 403,
      404, 409 e 500; `QueryFailedError` `23505` → 409 e `23503` → 409/404 sem nome de constraint; erro 500 cuja
      mensagem original contém texto de relato responde mensagem genérica sem esse texto; erro de parse do corpo
      (JSON malformado) responde 400 com mensagem fixa, sem trecho do corpo; violação `23514` (CHECK) responde 500
      genérico
- [ ] T015 [P] [US1] Teste de integração em `test/http/errors.e2e-spec.ts`: `requestId` da resposta igual ao `req.id`
      da linha de log; o corpo enviado nunca aparece na resposta nem nas linhas de log capturadas; JSON malformado e corpo
      vazio contendo texto de relato respondem 400 sem esse texto na resposta e no log

### Implementation for User Story 1

- [ ] T016 [P] [US1] Criar o tipo `ApiError` e as mensagens genéricas em português em `src/common/http/api-error.ts`
- [ ] T017 [P] [US1] Criar o módulo de fixture com rotas que lançam cada tipo de erro em
      `test/support/fixtures/error-fixture.module.ts`
- [ ] T018 [US1] Implementar o filtro global em `src/common/http/http-exception.filter.ts` (stack só no log, corpo da
      requisição nunca copiado, `requestId` vindo de `req.id`, erro de parse do body com mensagem fixa e sem a mensagem
      original do parser)
- [ ] T019 [US1] Registrar o filtro em `src/app.setup.ts`

**Checkpoint**: erros seguros em toda a API.

---

## Phase 4: User Story 2 - Entrada validada sem ecoar o que foi enviado (Priority: P1)

**Goal**: validação global com zod, campos desconhecidos recusados, limite de tamanho e mensagens sem o valor
(TRV-02).

**Independent Test**: enviar campo extra, texto longo e tipo errado a uma rota de fixture.

### Tests for User Story 2 (mandatory for security and privacy rules) ⚠️

- [ ] T020 [P] [US2] Teste unitário em `src/common/validation/validation-error.mapper.spec.ts`: `unrecognized_keys`
      sem a lista de chaves, `too_big` e `invalid_type` sem o valor recebido, saída `{ path, code, message }`
- [ ] T021 [P] [US2] Teste de integração em `test/http/validation.e2e-spec.ts`: 400 para campo extra, texto longo e
      tipo errado; nem a resposta nem o log contêm os valores enviados

### Implementation for User Story 2

- [ ] T022 [P] [US2] Criar os helpers `text({ max })` (padrão 2000), `uuid()` e `strictObject` em
      `src/common/validation/schemas.ts`
- [ ] T023 [P] [US2] Criar a rota de fixture com body validado por schema zod em
      `test/support/fixtures/validation-fixture.module.ts`
- [ ] T024 [US2] Implementar o mapeamento de issues em `src/common/validation/validation-error.mapper.ts`
- [ ] T025 [US2] Registrar o `StandardSchemaValidationPipe` global com `exceptionFactory` usando o mapper em
      `src/app.setup.ts`

**Checkpoint**: entrada validada em toda a API.

---

## Phase 5: User Story 3 - Configuração insegura impede a inicialização (Priority: P1)

**Goal**: variáveis dos serviços externos e segredos validados na inicialização, com regras de produção (TRV-03).

**Independent Test**: validar combinações de ambiente pelo schema e subir a API com configuração inválida.

### Tests for User Story 3 (mandatory for security and privacy rules) ⚠️

- [ ] T026 [P] [US3] Teste unitário em `src/config/env.schema.spec.ts`: produção com `VAULT_TOKEN` falha; produção
      sem `VAULT_ROLE_ID`/`VAULT_SECRET_ID` falha; segredo com menos de 32 bytes falha; `SESSION_SECRET` igual a
      `REPORTER_TOKEN_SECRET` falha; `PASSWORD_HASH_LOG_N` abaixo de 17 fora de `test` falha; a mensagem cita o nome
      da variável e nunca o valor

### Implementation for User Story 3

- [ ] T027 [US3] Ampliar `src/config/env.schema.ts` conforme `contracts/environment.md`, com `superRefine` para as
      regras de produção e de teste
- [ ] T028 [US3] Formatar os erros de validação de ambiente só com nomes de variáveis em
      `src/config/env.validate.ts` e usá-lo no `ConfigModule` de `src/app.module.ts`
- [ ] T029 [US3] Criar `test/support/test-env.ts` com os valores de teste (inclusive `PASSWORD_HASH_LOG_N=10`) e
      usá-lo em `test/support/test-app.ts`

**Checkpoint**: configuração insegura não sobe.

---

## Phase 6: User Story 4 - Acesso confiável ao serviço de chaves (Priority: P1)

**Goal**: cliente próprio do Vault Transit com timeout de 2 s, 503 quando indisponível, renovação de token e recusa
da `identity-kek` (TRV-04).

**Independent Test**: ciclo completo contra o Vault do compose e chamada com o Vault parado.

**Depende de**: US3 (variáveis do Vault).

### Tests for User Story 4 (mandatory for security and privacy rules) ⚠️

- [ ] T030 [P] [US4] Teste unitário em `src/infra/vault/vault.client.spec.ts` com `fetch` simulado: timeout gera
      `KeyServiceUnavailableError` em até 2 s; Vault selado gera o mesmo erro; mensagem e propriedades do erro não
      contêm plaintext, `wrapped` nem token; `identity-kek` é recusada antes de qualquer chamada de rede
- [ ] T031 [P] [US4] Teste unitário em `src/infra/vault/vault-auth.spec.ts`: renovação quando 2/3 do TTL passarem,
      novo login AppRole se a renovação falhar, modo token fora de produção
- [ ] T032 [P] [US4] Teste de integração em `test/infra/vault.e2e-spec.ts` contra o Vault do compose: gerar chave de
      dados, abrir, cifrar e decifrar com `app-kek`, recifrar
- [ ] T033 [P] [US4] Teste de integração em `test/http/key-service-unavailable.e2e-spec.ts`: rota de fixture que usa o
      `KeyService` com `VAULT_ADDR` inacessível responde `ApiError` 503 em até 3 s

### Implementation for User Story 4

- [ ] T034 [P] [US4] Criar `KeyServiceUnavailableError` (estende `ServiceUnavailableException`, mensagem fixa) em
      `src/infra/vault/key-service.errors.ts`
- [ ] T035 [US4] Implementar login AppRole, modo token e renovação em `src/infra/vault/vault-auth.ts`
- [ ] T036 [US4] Implementar o `KeyService` (`generateDataKey`, `decryptDataKey`, `encrypt`, `decrypt`, `rewrap`,
      allowlist `report-kek`/`app-kek`, `AbortSignal.timeout`) em `src/infra/vault/vault.client.ts`, conforme
      `contracts/key-service.md`
- [ ] T037 [US4] Criar `src/infra/vault/vault.module.ts` exportando o token `KEY_SERVICE` e importá-lo em
      `src/app.module.ts`
- [ ] T038 [US4] Criar a rota de fixture que usa o `KeyService` em `test/support/fixtures/key-service-fixture.module.ts`

**Checkpoint**: módulo `crypto` (feature 02) já pode ser construído sobre o `KeyService`.

---

## Phase 7: User Story 5 - Rotas públicas anônimas por construção (Priority: P1)

**Goal**: `@PublicApi` e `@AdminApi` com prefixos, tags, `no-store`, remoção de `Set-Cookie` e verificação automática
das rotas públicas (TRV-07).

**Independent Test**: o teste de convenção percorre todas as rotas e falha diante de uma rota pública fora da regra.

### Tests for User Story 5 (mandatory for security and privacy rules) ⚠️

- [ ] T039 [P] [US5] Teste unitário em `src/common/http/route-decorators.spec.ts`: `@PublicApi('x')` gera
      `/api/public/v1/x` com tag `public`; `@AdminApi('x')` gera `/api/admin/v1/x` com tag `admin`; os dois aplicam o interceptor de `no-store`
- [ ] T040 [P] [US5] Teste de integração em `test/conventions/public-routes.e2e-spec.ts`: via `DiscoveryService`,
      falha se rota pública tiver parâmetro de caminho diferente de `:attachmentId`; rota pública de fixture que tenta
      definir cookie responde sem `Set-Cookie` e com `Cache-Control: no-store`; requisição pública com
      `X-Forwarded-For` não deixa o IP em nenhuma linha de log; rota administrativa de fixture responde com
      `Cache-Control: no-store`

### Implementation for User Story 5

- [ ] T041 [P] [US5] Implementar o interceptor que define `Cache-Control: no-store` e `Pragma: no-cache` (públicas e
      administrativas) e remove `Set-Cookie` (só públicas) em `src/common/http/no-store.interceptor.ts`
- [ ] T042 [US5] Implementar `@PublicApi` e `@AdminApi` (prefixo, `@ApiTags`, metadado de área e interceptor) em
      `src/common/http/route-decorators.ts`
- [ ] T043 [US5] Criar os controllers de fixture, um público (com tentativa de cookie e rota com `:attachmentId`) e
      um administrativo, em `test/support/fixtures/public-fixture.module.ts`

**Checkpoint**: toda rota pública nova é verificada automaticamente.

---

## Phase 8: User Story 6 - Listagens paginadas e estáveis (Priority: P2)

**Goal**: paginação por cursor sobre UUID v7, até 100 itens, sem `OFFSET` nem `COUNT` (TRV-08).

**Independent Test**: paginar uma tabela inserindo registros no meio e conferir que nada se repete ou some.

### Tests for User Story 6

- [ ] T044 [P] [US6] Teste unitário em `src/common/pagination/cursor.spec.ts`: codificação e decodificação base64url,
      cursor adulterado gera erro de validação, `limit` acima de 100 recusado, padrão 20
- [ ] T045 [P] [US6] Teste de integração em `test/common/pagination.e2e-spec.ts`: paginar `categories` com inserções
      entre páginas sem repetição nem perda, e última página com `nextCursor` nulo

### Implementation for User Story 6

- [ ] T046 [P] [US6] Criar o schema de query (`limit`, `after`) e de resposta em `src/common/pagination/page.schema.ts`
- [ ] T047 [US6] Implementar `encodeCursor`, `decodeCursor` e `paginate(queryBuilder, { limit, after })` com
      `WHERE id > :after ORDER BY id LIMIT :limit + 1` em `src/common/pagination/cursor.ts`

**Checkpoint**: listagens das próximas features usam `paginate`.

---

## Phase 9: User Story 7 - Tarefas em segundo plano seguras (Priority: P2)

**Goal**: filas `notifications` e `maintenance` com tentativas, histórico limitado, idempotência, payload só com
identificadores e jobs agendados com execução única (TRV-05).

**Independent Test**: enfileirar o mesmo job duas vezes, provocar falha e conferir tentativas, efeito único e
payload.

**Depende de**: US3 (`REDIS_URL`).

### Tests for User Story 7 (mandatory for security and privacy rules) ⚠️

- [ ] T048 [P] [US7] Teste unitário em `src/infra/queue/job-payload.schema.spec.ts`: o schema base aceita UUID, enum
      e número e recusa qualquer texto livre
- [ ] T049 [P] [US7] Teste de integração em `test/infra/queue.e2e-spec.ts` contra o Redis do compose: mesmo `jobId`
      roda uma vez; job com falha é tentado de novo com backoff; job scheduler com dois workers gera uma execução por
      disparo; histórico respeita os limites

### Implementation for User Story 7

- [ ] T050 [P] [US7] Criar os padrões de job (`attempts`, `backoff`, `removeOnComplete`, `removeOnFail`) e o helper
      de `jobId` determinístico em `src/infra/queue/job-defaults.ts`
- [ ] T051 [P] [US7] Criar o schema base de payload em `src/infra/queue/job-payload.schema.ts`
- [ ] T052 [US7] Criar `src/infra/queue/queue.module.ts` com `BullModule.forRootAsync` (`REDIS_URL`) e as filas
      `notifications` e `maintenance`, e importá-lo em `src/app.module.ts`

**Checkpoint**: notifications, retention e crypto podem enfileirar jobs.

---

## Phase 10: User Story 8 - Base de testes que prova as regras de privacidade (Priority: P2)

**Goal**: factories (usuário com perfis, categoria, denúncia cifrada) e custo de hash reduzido nos testes, sobre o
harness da fase 2 (TRV-10).

**Independent Test**: um teste de exemplo cria uma denúncia cifrada e confere que o log de uma requisição pública não
contém o relato.

**Depende de**: US4 (`KeyService`, para cifrar a denúncia de teste) e US5 (rota pública de fixture da T043).

### Tests for User Story 8

- [ ] T053 [US8] Teste de integração em `test/support/factories.e2e-spec.ts`: as factories criam usuário com perfis,
      categoria e denúncia cuja `content_enc` decifra com a DEK aberta pelo `KeyService` e AAD
      `reports.content_enc:<id>`; uma requisição pública de fixture não deixa o texto do relato no log capturado

### Implementation for User Story 8

- [ ] T054 [US8] Implementar `createUser({ roles })`, `createCategory()` e `createEncryptedReport(content)` (DEK do
      `KeyService`, AES-256-GCM com o formato e o AAD da constituição) em `test/support/factories.ts`
- [ ] T055 [US8] Documentar o uso do harness (banco por suíte, log capture, factories, fixtures) em
      `test/support/README.md`

**Checkpoint**: novos testes de "não vazou" saem sem preparar infraestrutura à mão (SC-009).

---

## Phase 11: User Story 9 - Contrato da API publicado para o front (Priority: P2)

**Goal**: `npm run openapi:export` grava `openapi/public.json` e `openapi/admin.json` sem banco, e o CI confere e
publica (TRV-11, FR-038, FR-038a).

**Independent Test**: rodar o export duas vezes e conferir separação, schemas e saída idêntica.

**Depende de**: US5 (tags e prefixos dos decorators).

### Tests for User Story 9

- [ ] T056 [US9] Teste de integração em `test/openapi/export.e2e-spec.ts`: rodar o export num diretório temporário
      com um módulo de fixture com uma rota pública e uma administrativa; `public.json` só tem `/api/public/v1/*`,
      `admin.json` só tem `/api/admin/v1/*`, cada um só com os schemas que usa (inclusive `ApiError`), `/health` fora
      dos dois, e duas execuções geram arquivos idênticos

### Implementation for User Story 9

- [ ] T057 [US9] Implementar `src/scripts/export-openapi.ts`: app em modo `preview`, `SwaggerModule.createDocument`,
      separação por prefixo, poda de `components/schemas`, JSON com chaves ordenadas e `info.version` do
      `package.json`; se o modo preview não listar as rotas, usar o plano B do research (R9)
- [ ] T058 [US9] Acrescentar `"openapi:export": "npm run build && node dist/scripts/export-openapi.js"` em
      `package.json`, gerar e versionar `openapi/public.json` e `openapi/admin.json`
- [ ] T059 [US9] Acrescentar ao job `quality` de `.github/workflows/ci.yml` o export, `git diff --exit-code openapi/`
      e o upload de `openapi/` como artefato

**Checkpoint**: o `npm run api:sync` do front já consegue gerar os clientes `public` e `admin`.

---

## Phase 12: User Story 10 - Armazenamento de arquivos (Priority: P3)

**Goal**: storage S3 em streaming com `put`, `get`, `head`, `delete` e `deleteMany` (TRV-06).

**Independent Test**: gravar, ler, consultar e apagar um arquivo grande no SeaweedFS do compose.

**Depende de**: US3 (variáveis `S3_*`).

### Tests for User Story 10

- [ ] T060 [US10] Teste de integração em `test/infra/storage.e2e-spec.ts`: `put` e `get` de 20 MB em stream sem
      carregar em memória, `head` de existente e inexistente, `deleteMany` em lote; bucket criado só com
      `NODE_ENV=development`

### Implementation for User Story 10

- [ ] T061 [US10] Implementar `src/infra/storage/storage.service.ts` com `@aws-sdk/client-s3` e `Upload` do
      `@aws-sdk/lib-storage` (`forcePathStyle`), conforme `contracts/storage.md`
- [ ] T062 [US10] Criar `src/infra/storage/storage.module.ts` (criação do bucket só em desenvolvimento) e importá-lo
      em `src/app.module.ts`

**Checkpoint**: attachments (feature futura) usa o `StorageService`.

---

## Phase 13: User Story 11 - Criação do primeiro administrador (Priority: P3)

**Goal**: `create-admin` com senha lida sem eco, política de senha, hash scrypt do `@nestjs/authentication`, recusa se
já houver admin ativo e auditoria `USER_CREATED` na mesma transação (TRV-09, com USERS-01 e o núcleo da AUDIT-02).

**Independent Test**: rodar o comando no ambiente local e no container e conferir usuário, perfil, hash e auditoria.

**Depende de**: US3 (`PASSWORD_HASH_LOG_N`). Os componentes USERS-01, `PasswordHasher` e `AuditService` desta fase
ficam nos módulos definitivos e são reaproveitados pelas features users, auth e audit.

### Tests for User Story 11 (mandatory for security and privacy rules) ⚠️

- [ ] T063 [P] [US11] Teste unitário em `src/modules/auth/password/password-policy.spec.ts`: menos de 12 caracteres
      recusado, senha da lista local recusada (sem diferenciar maiúsculas), senha válida aceita
- [ ] T064 [P] [US11] Teste unitário em `src/modules/auth/password/password-hasher.provider.spec.ts`: o provider usa
      `PASSWORD_HASH_LOG_N`, gera `$scrypt$ln=...` e `verify` responde certo e errado
- [ ] T065 [P] [US11] Teste de integração em `test/modules/users.repository.e2e-spec.ts`: só `findCredentialsByEmail`
      devolve `password_hash`; os demais métodos devolvem o usuário com perfis e sem hash nem segredo de MFA; e-mail
      repetido vira 409 sem consulta prévia
- [ ] T066 [P] [US11] Teste de integração em `test/modules/audit.service.e2e-spec.ts`: gênese com `prev_hash` de 32
      bytes zerados; cada registro encadeia o anterior; 50 gravações concorrentes sem bifurcação; com `EntityManager`
      da transação do chamador, um rollback desfaz o registro; `occurred_at` definido pela aplicação confere com o
      hash
- [ ] T067 [P] [US11] Teste de integração em `test/cli/create-admin.e2e-spec.ts`: cria admin `ACTIVE` com perfil
      `ADMIN`, `mfa_enabled_at` nulo (sem segundo fator; a exigência no login fica em AUTH-03) e hash scrypt; grava `USER_CREATED` com ator `SYSTEM` e metadata sem dado pessoal;
      recusa o segundo sem `--force`; com `--force` audita `forced: true`; e-mail repetido sai com código 1; a saída
      nunca contém a senha nem o hash; duas execuções simultâneas criam um único admin

### Implementation for User Story 11

- [ ] T068 [P] [US11] Implementar `UsersRepository` (USERS-01: `findCredentialsByEmail`, `findById`,
      `createWithRoles` mapeando `23505` para 409) em `src/modules/users/users.repository.ts` e exportá-lo em
      `src/modules/users/users.module.ts`
- [ ] T069 [P] [US11] Implementar a política de senha em `src/modules/auth/password/password-policy.ts`, com a lista
      local em `src/modules/auth/password/common-passwords.txt` (copiada para `dist/` no build)
- [ ] T070 [P] [US11] Criar o provider `PasswordHasher` por factory (`new PasswordHasher({ logN })`), sem importar
      `AuthenticationModule`, em `src/modules/auth/password/password-hasher.provider.ts` e exportá-lo em
      `src/modules/auth/auth.module.ts`
- [ ] T071 [P] [US11] Implementar o cálculo do hash com metadata canônica (chaves ordenadas) em
      `src/modules/audit/audit-hash.ts`
- [ ] T072 [US11] Implementar `AuditService.record()` (advisory lock, último hash, `occurred_at` da aplicação,
      `EntityManager` opcional) em `src/modules/audit/audit.service.ts` e exportá-lo em
      `src/modules/audit/audit.module.ts`
- [ ] T073 [P] [US11] Implementar a leitura de senha sem eco por `node:readline` em `src/cli/password-prompt.ts`
- [ ] T074 [US11] Implementar o comando em `src/cli/create-admin.command.ts` (advisory lock próprio, checagem de admin
      ativo, criação e auditoria numa transação, códigos de saída de `contracts/cli-create-admin.md`)
- [ ] T075 [US11] Criar o entrypoint `src/cli.ts` (`CommandFactory` do nest-commander) e o script
      `"cli": "node dist/cli.js"` em `package.json`
- [ ] T076 [US11] Conferir o comando dentro da imagem de produção, rodando `node dist/cli.js create-admin` no
      container `api` do `docker-compose.yml`, e registrar o passo em `README.md`

**Checkpoint**: o primeiro administrador pode ser criado em qualquer ambiente.

---

## Phase 14: User Story 12 - Referência de proxy que preserva o anonimato (Priority: P3)

**Goal**: configuração nginx de referência sem access log e sem `X-Forwarded-For` nas rotas públicas, com TLS e HSTS
(TRV-12).

**Independent Test**: subir o nginx de referência na frente de um upstream de eco e conferir logs e cabeçalhos.

### Tests for User Story 12 (mandatory for security and privacy rules) ⚠️

- [ ] T077 [US12] Criar o teste de fumaça `docs/deploy/nginx/smoke-test.sh`: sobe o nginx com a configuração e um
      upstream de eco em containers; requisição pública não gera linha de access log e chega sem `X-Forwarded-For`;
      requisição administrativa gera linha com IP; `nginx -t` passa

### Implementation for User Story 12

- [ ] T078 [US12] Escrever `docs/deploy/nginx/canal-denuncias.conf` (`access_log off` e
      `proxy_set_header X-Forwarded-For ""` em `/api/public/`, log com IP em `/api/admin/`,
      `ssl_protocols TLSv1.2 TLSv1.3`, HSTS e `client_max_body_size` igual a `MAX_ATTACHMENT_BYTES`)
- [ ] T079 [US12] Escrever `docs/deploy/proxy.md` (por que cada diretiva existe, como validar com o smoke test e o que
      não pode ser alterado)

**Checkpoint**: TRV-12 pronta para o checklist de produção.

---

## Phase 15: Polish & Cross-Cutting Concerns

- [ ] T080 [P] Atualizar `AGENTS.md` com as regras novas: validar só com schemas zod de `src/common/validation`,
      declarar rotas só com `@PublicApi`/`@AdminApi`, auditar só por `AuditService.record()`
- [ ] T081 [P] Atualizar `README.md` (variáveis novas, `npm run openapi:export`, `npm run cli`, harness de testes)
- [ ] T082 Marcar os critérios de aceite concluídos de TRV-01 a TRV-12 (e de USERS-01) em `docs/tarefas/` e anotar em
      `docs/tarefas/02-audit.md` que o núcleo da AUDIT-02 foi entregue nesta feature
- [ ] T083 Rodar `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run test:cov` (cobertura de pelo
      menos 80% em `src/common`, `src/infra` e nos arquivos novos dos módulos) e `npm run test:e2e`
- [ ] T084 Executar os 7 cenários de `specs/001-transversal-infrastructure/quickstart.md` e registrar o resultado
- [ ] T085 Rodar o build do `Dockerfile`, o Trivy e o gitleaks como em `.github/workflows/ci.yml` e conferir que não
      há vulnerabilidade HIGH/CRITICAL corrigível

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (fase 1)**: sem dependências. T001 vem antes de qualquer código (princípio IX).
- **Foundational (fase 2)**: depende do Setup e bloqueia todas as user stories.
- **User stories (fases 3 a 14)**: dependem da fase 2. Dependências entre elas:
  - US4 (Vault), US7 (fila), US10 (storage) e US11 (create-admin) dependem de **US3** (variáveis de ambiente).
  - US8 (factories) depende de **US4** (`KeyService`) e de **US5** (rota pública de fixture).
  - US9 (OpenAPI) depende de **US5** (tags e prefixos).
  - US1, US2, US5, US6 e US12 só dependem da fase 2.
- **Polish (fase 15)**: depois das user stories desejadas.

### User Story Dependencies

```text
Fase 2 ──┬── US1 (erros)
         ├── US2 (validação)
         ├── US3 (ambiente) ──┬── US4 (Vault) ── US8 (factories)
         │                    ├── US7 (fila)
         │                    ├── US10 (storage)
         │                    └── US11 (create-admin)
         ├── US5 (rotas) ──┬── US9 (OpenAPI)
         │                 └── US8 (factories, também depende da US4)
         ├── US6 (paginação)
         └── US12 (proxy)
```

### Within Each User Story

- Testes escritos primeiro e falhando antes da implementação.
- Tipos e erros, depois serviços, depois registro no app.
- A história fecha no seu checkpoint antes da próxima prioridade.

### Parallel Opportunities

- Setup: T003, T004 e T005.
- Fase 2: T008, T009 e T010.
- Depois da fase 2: US1, US2, US3, US5, US6 e US12 em paralelo. Depois da US3: US4, US7, US10 e US11 em paralelo. A US8 começa quando US4 e US5 terminarem.
- Em cada história, os testes marcados [P] juntos e as implementações [P] juntas.

---

## Parallel Example: User Story 11

```bash
# Testes primeiro, todos em paralelo:
Task: "T063 password-policy.spec.ts"
Task: "T064 password-hasher.provider.spec.ts"
Task: "T065 test/modules/users.repository.e2e-spec.ts"
Task: "T066 test/modules/audit.service.e2e-spec.ts"
Task: "T067 test/cli/create-admin.e2e-spec.ts"

# Depois, as implementações independentes:
Task: "T068 users.repository.ts"
Task: "T069 password-policy.ts"
Task: "T070 password-hasher.provider.ts"
Task: "T071 audit-hash.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Fase 1 (Setup) e fase 2 (Foundational).
2. Fase 3 (US1, erros seguros).
3. **Parar e validar**: T014 e T015 verdes, nenhum dado de entrada em resposta ou log.

### Incremental Delivery

1. Setup + Foundational.
2. P1 na ordem US1 → US2 → US3 → US4 → US5. Fecha a base que destrava as features crypto e audit.
3. P2: US6, US7, US8, US9 (com a US9, o front gera os clientes).
4. P3: US10, US11 (primeiro administrador), US12.
5. Polish.

### Parallel Team Strategy

Depois da fase 2: uma pessoa em US1 + US2, outra em US3 → US4 → US8 (a US8 espera também a US5), outra em US5 → US9, e US6 e US12 para quem
ficar livre. Depois da US3: US7, US10 e US11 em paralelo.

---

## Notes

- [P] = arquivos diferentes e sem dependência de tarefa incompleta.
- Nenhum teste de privacidade pode ser removido ou afrouxado para fazer o código passar.
- Commit ao fim de cada tarefa ou grupo lógico (Conventional Commits).
- Nada nesta feature cria tabela ou migration.

---

## Pendências do analyze

Achados do `/speckit-analyze` de 2026-11-27 que não bloqueiam o implement. Resolver durante a tarefa indicada.

| ID  | Onde resolver           | O que fazer                                                                                                                                                                                                                                        |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3  | T031, T033              | Testar o Vault voltando ao ar sem reiniciar a API e a credencial expirando no meio da requisição (o 23514 já entrou na T014)                                                                                                                       |
| I3  | T054                    | A factory de denúncia cifrada passa a usar o `CryptoService` quando a feature crypto existir. Até lá, seguir o formato da constituição (versão, nonce, ciphertext, tag e AAD `<tabela>.<campo>:<id>`)                                              |
| U2  | T001 ou T080            | Acrescentar à árvore do `plan.md` os arquivos citados nas tarefas: `test/support/test-env.ts`, `test/support/fixtures/*`, `src/config/env.validate.ts`, `src/cli/password-prompt.ts`, `test/support/README.md` e `docs/deploy/nginx/smoke-test.sh` |
| U3  | T069                    | Configurar `assets` em `nest-cli.json` para copiar `common-passwords.txt` para `dist/`                                                                                                                                                             |
| U4  | T003                    | Acrescentar `TEST_ADMIN_DATABASE_URL` (só testes) a `contracts/environment.md`                                                                                                                                                                     |
| I4  | T001                    | Corrigir no `research.md` (R6) o ID da política de senha: AUTH-05, não AUTH-04                                                                                                                                                                     |
| A1  | T080                    | Registrar no `AGENTS.md` que todo texto livre usa o helper `text({ max })`                                                                                                                                                                         |
| C4  | T076, T077              | Opcional: job de CI para o smoke test do proxy e para o `create-admin` dentro da imagem                                                                                                                                                            |
| C5  | T056                    | Acrescentar a asserção de que `/docs` fica indisponível com `NODE_ENV=production`                                                                                                                                                                  |
| C6  | Feature do primeiro job | Quando existir o primeiro job, tornar genérico o teste de "nenhum schema de job aceita texto livre"                                                                                                                                                |
