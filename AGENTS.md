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
- Auditoria só por `AuditService.record()`, de preferência com o `EntityManager` da transação da operação.
- Chaves só pelo `KEY_SERVICE` (`src/infra/vault`). A API nunca usa a `identity-kek`.
- Payload de job só com `jobPayloadSchema` (UUID, enum, número) e enfileirado com `addValidatedJob`.
- Listagens com `paginate()` e `pageQueryShape` (cursor, sem OFFSET).
- Mudou rota ou schema de entrada/saída: rode `npm run openapi:export` e commite `openapi/` (o CI confere).
- Testes de "não vazou" usam também textos curtos (ex.: `XQZ`): bibliotecas truncam mensagens e escondem vazamento parcial.

## Princípios

A constituição do projeto, em `.specify/memory/constitution.md`, prevalece sobre qualquer outra orientação. Todo plano do Spec Kit precisa passar pela checagem dela.
