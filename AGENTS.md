# AGENTS.md

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation, with a markdown page per chapter.

The official NestJS agent skills are installed with `npx @nestjs/skills add --agent all`, which also updates them: the mistakes agents make in Nest apps, with recipes checked on the released packages. An agent loads a skill when a task matches it.

Nest has first-party packages for these, so check them before adding another library or writing your own:

- Databases: [`@nestjs/typeorm`](https://docs.nestjs.com/data/typeorm.md), [`@nestjs/drizzle`](https://docs.nestjs.com/data/drizzle.md), [`@nestjs/mongoose`](https://docs.nestjs.com/data/mongodb.md), [`@nestjs/sequelize`](https://docs.nestjs.com/data/sequelize.md).
- OpenAPI: [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction.md). GraphQL: [`@nestjs/graphql`](https://docs.nestjs.com/graphql/quick-start.md). WebSockets: [`@nestjs/websockets`](https://docs.nestjs.com/websockets/gateways.md). Microservices: [`@nestjs/microservices`](https://docs.nestjs.com/microservices/basics.md).
- Sign-in: [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication.md). Permissions: [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization.md). Rate limiting: [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting.md).
- Configuration: [`@nestjs/config`](https://docs.nestjs.com/application/configuration.md). Caching: [`@nestjs/cache-manager`](https://docs.nestjs.com/data/caching.md). Health checks: [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus.md). Events inside the app: [`@nestjs/event-emitter`](https://docs.nestjs.com/application/events.md).
- Email: [`@nestjs/mail`](https://docs.nestjs.com/application/mail.md). Files, S3 included: [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage.md). Translations: [`@nestjs/i18n`](https://docs.nestjs.com/application/i18n.md).
- Retries, timeouts and circuit breakers: [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience.md).
- Idempotency keys: [`@nestjs/idempotency`](https://docs.nestjs.com/reliability/idempotency.md). Transactional outbox: [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox.md). Sending and receiving webhooks: [`@nestjs/webhooks`](https://docs.nestjs.com/http/webhooks.md).
- Queues: [`@nestjs/bullmq`](https://docs.nestjs.com/application/queues.md). Scheduled jobs: [`@nestjs/schedule`](https://docs.nestjs.com/application/task-scheduling.md).
- Running a scheduled job on one instance, and locks: [`@nestjs/locks`](https://docs.nestjs.com/reliability/locks.md). Processes that take days: [`@nestjs/workflows`](https://docs.nestjs.com/reliability/workflows.md).
- Language models, tools and agents: [`@nestjs/ai`](https://docs.nestjs.com/ai/overview.md). MCP servers: [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview.md).

Validation works with Zod, Valibot, ArkType or any other Standard Schema library, with no classes or decorator metadata: `StandardSchemaValidationPipe` with `@Body({ schema })` or `@Param('id', { schema })` (https://docs.nestjs.com/application/validation.md). `class-validator` still works, through `ValidationPipe`.

`NodeAdapter` from `@nestjs/platform-node` is the fastest HTTP adapter, ahead of Fastify (https://docs.nestjs.com/http/performance.md).

A route handler can return a web `Response`, a `ReadableStream` or an async generator, and Nest streams it as it's produced (https://docs.nestjs.com/http/streaming-responses.md).

Nest's packages are ESM only, and this project is ESM too: relative imports end in `.js`, `__dirname` doesn't exist (use `import.meta.dirname`), and tests run on Vitest, so mocks are `vi.fn()`, not `jest.fn()`.

In this project, `src/main.ts` creates the app and listens on `PORT` (3000 by default), `src/app.module.ts` is the root module that imports the 16 feature modules in `src/modules/`. Unit tests sit beside the code as `*.spec.ts` and the e2e test is in `test/`; Vitest runs them (`npm test`, `npm run test:e2e`).

When a task says how to test, follow it. When it says nothing, cover the behaviour you change with focused tests rather than adding broad e2e suites.

## Este projeto

API do Canal de Denúncias de Vazamento de Dados. Leia o README.md e docs/adr/README.md antes de mudar algo.

Regras que não podem ser quebradas:

- Nenhuma telemetria ou log sai para serviços externos. O NestJS Observe foi removido de propósito: não reinstale e não sugira `npx @nestjs/observe link`.
- Rotas públicas (`/api/public/v1/*`) nunca registram IP, user-agent ou cabeçalhos. Protocolo, chave e dados pessoais nunca vão no caminho da URL.
- Conteúdo de denúncia nunca vai para logs, para `audit_logs.metadata` ou para mensagens de erro.
- `synchronize` do TypeORM fica sempre desligado. Mudança de schema = migration revisada. Toda entidade nova entra em `src/database/entities.ts`.
- Migrations geradas tentam recriar enums compartilhados (`actor_type`, `report_status`, `report_outcome`): remova as duplicatas antes do commit.
- Propriedades de relação nas entidades usam `Relation<T>` (evita referência circular de metadados em ESM).
- Entrada só com schemas zod montados com `src/common/validation/schemas.ts`: `strictObject` (campos extras dão 400) e
  todo texto livre com `text({ max })`, nunca `z.string()` puro. Mensagens de `refine` nunca interpolam valores.
- Controllers só com `@PublicApi('recurso')` ou `@AdminApi('recurso')`. Rota pública não tem parâmetro de caminho além
  de `:attachmentId` (o teste `test/conventions/public-routes.e2e-spec.ts` falha se tiver).
- Auditoria só por `AuditService.record()`, de preferência com o `EntityManager` da transação da operação. A ação vem
  do catálogo `AuditAction` (com `AuditResourceType`) e a metadata segue o schema da ação em
  `audit-metadata.schemas.ts`: só UUID, enums, inteiros, datas e códigos, nunca texto. Ação nova = entrada no enum e no
  mapa de schemas.
- O ator da auditoria vem só do contexto (D46): rota `@PublicApi` → denunciante sem IP; `@AdminApi` → equipe com a
  identidade do guard. Fora de requisição (CLI, jobs), rode dentro de `runAsSystem()`; processador de fila usa
  `systemJob()`. A entrada de `record()` não aceita ator, IP nem user-agent.
- Leituras sensíveis em rotas: `@Audited(ação, tipo, resolveId)`. O `resolveId` só lê parâmetros e query.
- Toda rota `@AdminApi` exige identidade (401 sem ela, D47). Nos testes, rota sem política (fixtures da auditoria,
  por exemplo) pode usar `createTestApp({ identity: true })` e o cabeçalho de `testIdentity()`; rota com política sobre
  o usuário da sessão (como as de `users` e `me`) usa a sessão real pelas rotas definitivas de login (feature 006;
  `test/auth/support.ts`, `test/users/support.ts`; `createStaff` cria a pessoa com a senha já trocada). Nunca importe
  `test/` de `src/` (teste de convenção).
- Autenticação só pelo `@nestjs/authentication` e autorização só pelo `@nestjs/authorization`, em versões exatas
  (D53, D54, `docs/adr/0053-autenticacao-e-autorizacao.md`). A área administrativa autentica só pela sessão por
  cookie: nenhum token portador nem refresh token (canal de tokens só por decisão própria futura). Sessões e MFA só
  nos stores Postgres de `src/infra/auth/stores/` (`allowInMemoryStorage: false`).
- `@PublicApi` já abre a rota no guard global. Nada de `@Public()` em rota administrativa: rota de login ou do
  desafio MFA usa `OpenAdminRoute()`. Toda rota administrativa declara `@Can(Política, 'método')`; sem declaração,
  responde 403 e aparece no log da inicialização. `@Can.Anyone()` só nas rotas da própria pessoa listadas em
  `ANYONE_ALLOWED` (`test/conventions/admin-route-checks.ts`); o teste de convenção falha fora disso (D62).
- Eventos de autenticação e negações entram na trilha só pelo `AuthAuditSubscriber`; evento novo do pacote = entrada
  no mapeamento dele e no catálogo da auditoria. Tempo de sessão e MFA nos testes: `TestClock` no `AUTH_CLOCK`.
  Tempos da sessão só em `src/infra/auth/session-policy.ts`.
- Login da equipe (D57): no fluxo de login, 401 só para sessão ausente ou expirada (na entrada, é a falha genérica de
  credencial, igual para todo motivo e no mesmo tempo); rota de etapa (troca de senha, cadastro do MFA) só com
  `StepRoute` (403 `STEP_NOT_ALLOWED` fora da etapa); com troca obrigatória pendente, o `LoginStepGuard` responde 403
  `PASSWORD_CHANGE_REQUIRED` (liberar uma rota só com `AllowDuringPasswordChange`, hoje só o `GET /me`). Toda falha de
  entrada faz as mesmas consultas numa transação (tempo constante, `npm run test:timing`).
- Números do bloqueio progressivo e do limite de tentativas só pelo ambiente (`LOGIN_LOCKOUT_*`, `AUTH_RATE_LIMIT_*`);
  chave de HMAC só pelas chaves por finalidade de `src/infra/auth/hmac-keys.ts` (nada de e-mail em claro no Redis).
  Rota nova de entrada passa pelo `AuthThrottleGuard`.
- Habilidade nova só no catálogo `src/modules/access-control/abilities.ts` (D55), no formato
  `^[a-z][a-z-]*\.[a-z][a-z-]*$`; políticas consultam `hasAbility`, nunca o perfil direto. O `GET /me` devolve o
  catálogo: renomear ou remover um código quebra o front. Mudou a matriz do ACL-01, mude o catálogo junto (teste).
- Alcance por registro (todas ou só as atribuídas) só no `recordScope` do catálogo (D60); nada de perfil em política.
  Método novo de política = entrada no `src/modules/access-control/policy-abilities.ts` (código e tipo de recurso
  da trilha, D61; teste).
- Denúncias (D59, D60, D62; contrato em `specs/007-access-control-policies/contracts/access-control.md`): a rota
  declara a habilidade (`ReportsPolicy.list`/`readAny`/`triageAny`/`treatAny`, `IdentityRevealPolicy.requestAny`/
  `decideAny`, `RetentionPolicy.manage`); rota por id chama `ReportAccessService.resolve(user, id, habilidade)`
  antes de tudo (404 igual para fora do escopo e inexistente, auditado; 410 com `{ content: true }`) e depois
  `authorize()` com os fatos devolvidos; nunca 404/410 próprio nem consulta antes do `resolve`. Listagem só com
  `scopeReportsFor(user, qb)` no query builder, nunca filtro depois de carregar.
- Erro de regra de negócio com `DomainError`/`DomainConflictError` e `code` estável em maiúsculas (D56); `details` só
  com inteiros e códigos, nunca valor recebido.
- Operação que pode mudar a quantidade de Administradores ativos roda com o lock de `src/modules/users/admin-lock.ts`
  e confere a contagem na mesma transação; escrita sobre outra pessoa trava as linhas de quem age e do alvo
  (`UsersRepository.lockPair`) e confere de novo quem age.
- A trilha é particionada por mês (D48). Ninguém altera nem apaga registro; a única remoção é a do comando
  `audit-maintenance`, com o perfil `app_audit_maintenance`, de partições com mais de 5 anos (D49 a D51). Partição nova
  só pela função `audit_ensure_partitions`.
- Em SQL com `id::text AS id`, ordene pela coluna da tabela (`ORDER BY l.id`), não pelo alias: o alias em texto
  ordena "10" antes de "5".
- Chaves só pelo `KEY_SERVICE` (`src/infra/vault`). A API nunca usa a `identity-kek` nem tem `rewrap` (D43).
- Conteúdo sensível só pelo `CryptoModule`: `DataKeyService.createReportKey`/`withReportKey` (a DEK só existe dentro
  da função e é zerada no fim), `RecordCipher` (JSON versionado com schema e texto), `AppSecretService` (segredos
  pequenos, presos ao registro) e `createEncryptStream`/`createDecryptStream` (arquivos). Nada de `createCipheriv` fora
  de `src/modules/crypto/`.
- O contexto de cifragem sai só de `encryptionContext(campo, id)`; campo novo entra em `ENCRYPTED_FIELDS`.
- Registro com conteúdo cifrado tem o id gerado por `newRecordId()` antes da cifragem (a AAD precisa do id).
- Chave de dados e cifragem sempre **antes** de abrir a transação do banco: nada de chamada ao Vault dentro de
  transação.
- Recifragem só pelo comando `rewrap-keys`, com o perfil de manutenção (`docs/deploy/vault/README.md`).
- Testes e2e que exercitam fluxos da API usam `createTestApp({ vault: 'api' })`: o token root esconderia falta de
  permissão na política real.
- Payload de job só com `jobPayloadSchema` (UUID, enum, número) e enfileirado com `addValidatedJob`.
- Listagens com `paginate()` e `pageQueryShape` (cursor, sem OFFSET).
- Mudou rota ou schema de entrada/saída: rode `npm run openapi:export` e commite `openapi/` (o CI confere).
- Testes de "não vazou" usam também textos curtos (ex.: `XQZ`): bibliotecas truncam mensagens e escondem vazamento parcial.

## Princípios

A constituição do projeto, em `.specify/memory/constitution.md`, prevalece sobre qualquer outra orientação. Todo plano do Spec Kit precisa passar pela checagem dela.
