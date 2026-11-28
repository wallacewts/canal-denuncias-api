# Canal de Denúncias — API

API do sistema de denúncias de vazamento de dados. Recebe relatos anônimos de colaboradores, parceiros e terceiros
sobre vazamentos, práticas inadequadas de segurança e atividades suspeitas, e precisa ser ela mesma um exemplo de
conformidade com a LGPD.

As decisões de arquitetura estão em [`docs/adr/`](docs/adr/README.md) e o backlog de implementação, quebrado em
tarefas por módulo, em [`docs/tarefas/`](docs/tarefas/README.md).

## Stack

|                   |                                                       |
| ----------------- | ----------------------------------------------------- |
| Runtime           | Node.js 26 (LTS), ESM                                 |
| Framework         | NestJS 12                                             |
| Banco             | PostgreSQL 18 + TypeORM 1.x                           |
| Chaves            | HashiCorp Vault (Transit)                             |
| Anexos            | Storage S3-compatível (SeaweedFS no ambiente local)   |
| Filas             | Redis + BullMQ                                        |
| Validação         | zod 4 (`StandardSchemaValidationPipe`)                |
| Hash de senha     | scrypt (`PasswordHasher` do `@nestjs/authentication`) |
| Testes            | Vitest + Supertest                                    |
| Lint / formatação | oxlint + Prettier                                     |

## Rodando localmente

Pré-requisitos: Node.js 26 e Docker com Compose.

```bash
cp .env.example .env
npm ci
docker compose up -d          # Postgres, Vault, Redis, S3 e Mailpit
npm run migration:run         # aplica as migrations com o perfil app_migrator
npm run start:dev             # API em http://localhost:3000
```

| Endereço                     | O que é                                          |
| ---------------------------- | ------------------------------------------------ |
| http://localhost:3000/health | Liveness (não toca no banco)                     |
| http://localhost:3000/ready  | Readiness (verifica o banco)                     |
| http://localhost:3000/docs   | Swagger (desligado quando `NODE_ENV=production`) |
| http://localhost:8025        | Mailpit (e-mails enviados em desenvolvimento)    |
| http://localhost:8200        | Vault em modo dev (token `dev-root-token`)       |

Para subir tudo em containers, incluindo as migrations e a API:

```bash
docker compose --profile app up -d --build
```

O ClamAV é pesado (cerca de 1 GB de RAM) e fica num perfil próprio: `docker compose --profile av up -d`.

## Primeiro administrador

O primeiro ADMIN é criado pela CLI. A senha é digitada no terminal, sem eco, e nunca vai em argumento, variável de
ambiente ou pipe (o comando recusa rodar sem terminal interativo).

```bash
npm run build && npm run cli -- create-admin --name "Nome" --email "admin@empresa.com"
# no container de produção:
docker compose --profile app run --rm api node dist/cli.js create-admin --name "Nome" --email "admin@empresa.com"
```

- Recusa se já existir um ADMIN ativo, a menos que receba `--force` (a criação forçada também é auditada).
- Senha com no mínimo 12 caracteres e fora da lista de senhas comuns.
- Grava `USER_CREATED` na trilha de auditoria, na mesma transação. O cadastro do MFA é exigido no primeiro login.

## Scripts

| Script                                                          | Faz                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm run start:dev`                                             | API com recarga automática                                   |
| `npm run build`                                                 | Compila para `dist/`                                         |
| `npm test` / `npm run test:cov`                                 | Testes unitários (com cobertura)                             |
| `npm run test:e2e`                                              | Testes e2e (precisa do Postgres com as migrations aplicadas) |
| `npm run lint` / `npm run typecheck` / `npm run format:check`   | Qualidade                                                    |
| `npm run migration:create -- src/database/migrations/Nome`      | Migration vazia, escrita à mão                               |
| `npm run migration:generate -- src/database/migrations/Nome`    | Migration gerada a partir das entidades                      |
| `npm run migration:run` / `migration:revert` / `migration:show` | Aplica, desfaz a última, lista                               |

## Banco de dados

- **Dois perfis**, criados por [`docker/postgres/01-roles.sh`](docker/postgres/01-roles.sh):
  - `app_migrator`: dono do schema. Usado só pelas migrations (`DATABASE_MIGRATOR_URL`).
  - `app_runtime`: usado pela API (`DATABASE_URL`). Só DML, sem `UPDATE`/`DELETE` em `audit_logs` e sem acesso à
    tabela de migrations.
- **`synchronize` nunca é ligado.** Toda mudança de schema passa por migration.
- **Revise toda migration gerada antes do commit.** O TypeORM tenta criar mais de uma vez os enums usados em mais de
  uma tabela (`actor_type`, `report_status`, `report_outcome`). A `InitialSchema` já foi corrigida à mão.
- **Toda entidade nova entra em [`src/database/entities.ts`](src/database/entities.ts)**, a lista usada pela API e
  pela CLI.
- O CI falha se as entidades e o banco divergirem (roda `migration:generate` e exige "No changes").

| Migration           | Conteúdo                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `Extensions`        | `citext`                                                                                          |
| `InitialSchema`     | 16 tabelas, enums, índices, FKs e CHECKs                                                          |
| `AuditImmutability` | Triggers que bloqueiam `UPDATE`/`DELETE`/`TRUNCATE` em `audit_logs` + `REVOKE` para `app_runtime` |
| `SeedCatalog`       | 3 categorias e valores padrão de SLA e retenção                                                   |

## Regras de privacidade que o código precisa seguir

- **Rotas públicas (`/api/public/v1/*`) nunca registram IP, user-agent nem cabeçalhos.** O logger já descarta IP,
  cabeçalhos, query string e corpo de todas as requisições (veja `src/config/logger.config.ts` e o teste ao lado).
- **Nenhuma rota leva protocolo, chave ou dado pessoal no caminho da URL.** Esses dados vão no corpo da requisição.
- **Conteúdo de denúncia nunca vai para log, auditoria (`metadata`) ou mensagem de erro.**
- **Nenhuma telemetria sai para serviços externos.** O projeto foi gerado com o NestJS Observe, que foi removido de
  propósito.

## Estrutura

```
src/
├── main.ts                     helmet, CORS, prefixo /api, Swagger fora de produção
├── app.module.ts
├── config/                     variáveis de ambiente (zod) e logger
├── common/                     enums do domínio e decorators compartilhados
├── database/                   opções do TypeORM, lista de entidades, data source da CLI e migrations
└── modules/                    16 módulos (auth, users, access-control, reports, public-tracking,
                                case-management, messages, attachments, identity-vault, crypto, audit,
                                notifications, retention, catalog, reporting, health)
```

## Commits

Conventional Commits, validados pelo `commitlint` no hook `commit-msg`. O `lint-staged` formata e roda o lint nos
arquivos alterados no `pre-commit`.
