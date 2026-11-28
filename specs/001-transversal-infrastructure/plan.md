# Implementation Plan: Infraestrutura transversal da API

**Branch**: `main` (sem branch de feature, decisão de 2026-11-27) | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-transversal-infrastructure/spec.md`

## Summary

Entregar a base usada por todos os módulos da API, cobrindo as 12 tarefas de `docs/tarefas/00-transversal.md`
(TRV-01 a TRV-12):

- erros num formato único que nunca vaza dados;
- validação com zod que recusa campos desconhecidos e não ecoa valores;
- configuração validada na inicialização, com regras de produção;
- cliente próprio e enxuto do Vault Transit;
- fila BullMQ com padrões seguros e job schedulers;
- storage S3 em streaming;
- convenções de rota pública e administrativa verificadas por teste;
- paginação por cursor;
- base de testes com banco clonado por suíte e captura de log;
- contrato OpenAPI exportado por `npm run openapi:export` em dois arquivos versionados (`openapi/public.json` e
  `openapi/admin.json`), usados pelo `npm run api:sync` do front, e conferido no CI;
- referência de proxy nginx;
- comando `create-admin`.

Para fechar a TRV-09 sem implementar users e auth inteiros, a feature traz USERS-01 completo (repositório de
usuários), o `PasswordHasher` (scrypt) do `@nestjs/authentication` com a política de senha e só o núcleo da
AUDIT-02 (`AuditService.record()` com cadeia de hash), conforme as decisões Q-P1 e Q-P2 do usuário.

## Technical Context

**Language/Version**: TypeScript 6 sobre Node.js 26 LTS, ESM

**Primary Dependencies**:

- Já instaladas: NestJS 12 (`@nestjs/common`, `core`, `config`, `typeorm`, `swagger`, `terminus`), TypeORM 1.1,
  `pg`, `nestjs-pino`, `helmet`, `zod@4.6.7`.
- Novas: `@nestjs/bullmq@12.0.2`, `bullmq@6.7.10`, `@aws-sdk/client-s3@3.1179.0`, `@aws-sdk/lib-storage@3.1179.0`,
  `nest-commander@3.21.0`, `@nestjs/authentication@0.1.8` (versão fixada; só o `PasswordHasher`) e
  `ioredis@5.11.1` (o BullMQ 6 em ESM exige um cliente Redis já construído; a versão 5 atende também o peer do TypeORM).
- Sem biblioteca para o Vault: cliente próprio sobre `fetch` (R2).

**Storage**: PostgreSQL 18 (sem tabelas novas), Redis 8 (fila), storage S3-compatível (SeaweedFS em dev), Vault
Transit (chaves)

**Testing**: Vitest 4 com Supertest. Integração contra os serviços do `docker-compose.yml`, com banco clonado por suíte
(R8).

**Target Platform**: container Linux (`node:26-alpine`), on-premise

**Project Type**: web-service (API REST) com CLI administrativa no mesmo pacote

**Performance Goals**: chamada ao Vault com timeout de 2 s. Resposta 503 em até 3 s com o Vault indisponível (SC-005).
Upload e download de anexos em streaming, sem carregar o arquivo em memória.

**Constraints**:

- Nenhum dado sensível em log, erro, job ou URL.
- Nenhuma telemetria externa.
- Rotas públicas sem cookie e sem cache.
- `audit_logs` append-only.
- Imports relativos com `.js`.

**Scale/Scope**: uma empresa, volume de canal de denúncias (dezenas a centenas de denúncias por mês). A
infraestrutura precisa suportar várias instâncias da API (job schedulers e Redis compartilhado).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Confira cada portão contra `.specify/memory/constitution.md`. Marque ✅ ou explique a violação em "Complexity Tracking".

- [x] **I. Anonimato**: ✅ A convenção `@PublicApi` aplica `no-store` e remove `Set-Cookie`, e `@AdminApi` também aplica
      `no-store` (FR-025). Um teste de convenção
      percorre as rotas e falha com parâmetro de caminho diferente do UUID de anexo (FR-023). O filtro de erro não
      copia corpo nem cabeçalhos (FR-004). O logger atual já descarta IP, cabeçalhos e query string. A referência de
      proxy desliga o access log e remove `X-Forwarded-For` nas rotas públicas.
- [x] **II. Minimização**: ✅ Erros genéricos no 500 e validação sem eco do valor (R1). Jobs só com identificadores,
      validados por schema (R4). Exceções do cliente do Vault sem corpo (R2). Nenhuma dependência nova faz telemetria.
- [x] **III. Criptografia**: ✅ O cliente do Vault expõe `datakey`, `decrypt`, `encrypt` e `rewrap` para `report-kek`
      e `app-kek`. Uma allowlist no cliente recusa `identity-kek` (D24) e um teste garante isso. Esta feature não grava
      dados cifrados: as factories de teste cifram denúncias pelo mesmo cliente.
- [x] **IV. Acesso**: ✅ N/A nesta feature. Nenhuma rota administrativa de negócio é criada. `@AdminApi` prepara a
      declaração de permissão por rota, que o módulo access-control (ACL-02) vai tornar obrigatória.
- [x] **V. Auditoria**: ✅ O `create-admin` grava `USER_CREATED` (ator `SYSTEM`) pelo
      `AuditService.record()`, na mesma transação da criação do usuário. Nenhum código faz `UPDATE` ou `DELETE` em
      `audit_logs`. O núcleo da AUDIT-02 entra nesta feature (Q-P2).
- [x] **VI. Banco**: ✅ Nenhuma tabela nova nem migration. O e-mail único é tratado pela constraint (409), sem
      consulta prévia (USERS-01). A base de testes não altera a auditoria (banco clonado por suíte).
- [x] **VII. Testes**: ✅ Cada regra de privacidade tem teste escrito antes da implementação: - erro 500 sem texto de relato; - validação sem eco do valor; - log de rota pública sem IP; - rota pública sem cookie e com `no-store`; - teste de convenção de rotas; - job sem texto livre; - exceção do Vault sem plaintext; - recusa da `identity-kek`; - produção recusa token raiz e segredo curto.
- [x] **VIII. Qualidade**: ✅ A stack é a fixa da constituição. Os pacotes oficiais do Nest foram avaliados antes:
      `@nestjs/storage@0.0.5` e `@nestjs/locks@0.0.6` foram rejeitados por imaturidade, com justificativa no
      research. O `@nestjs/authentication` foi adotado para o hash de senha (Q-P1), com versão fixada por ser 0.1.x. Nenhum segredo entra no repositório: o `create-admin`
      lê a senha do TTY.
- [x] **IX. Simplicidade**: ✅ Só o que as 12 tarefas pedem, mais o mínimo de USERS-01, AUTH e AUDIT-02 que a TRV-09
      exige (justificado em Complexity Tracking). As decisões D27 a D33 (inclusive a mudança da D03 pela D32) entram em `docs/adr/README.md` como primeira
      tarefa, antes do código.

**Reavaliação pós-design (Fase 1)**: ✅ Os artefatos de design (data-model, contracts, quickstart) não introduzem
nada que viole os portões. Com as respostas Q-P1 (B) e Q-P2 (A), o portão V fica atendido sem ressalva e o portão VIII registra o risco do pacote 0.1.x.

## Decisões do usuário (2026-11-27)

- **Q-P1 → B**: o hash da senha da equipe usa o `PasswordHasher` (scrypt) do `@nestjs/authentication@0.1.8`. Isso
  altera a D03 e antecipa o AUTH-00 no hash de senha. Só o hasher é usado: o `AuthenticationModule` (guard global e
  stores) fica para a feature de auth. Ver R6, inclusive os riscos (0.1.x e store em Postgres em produção).
- **Q-P2 → A**: o núcleo da AUDIT-02 (`AuditService.record()` com cadeia de hash e advisory lock) entra nesta
  feature. Ver R7.

## Project Structure

### Documentation (this feature)

```text
specs/001-transversal-infrastructure/
├── spec.md
├── plan.md              # este arquivo
├── research.md          # Fase 0
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1
├── contracts/           # Fase 1
│   ├── error-response.schema.json
│   ├── page.schema.json
│   ├── environment.md
│   ├── route-conventions.md
│   ├── key-service.md
│   ├── queue.md
│   ├── storage.md
│   ├── cli-create-admin.md
│   └── openapi-export.md
├── checklists/requirements.md
└── tasks.md             # Fase 2 (/speckit-tasks, não criado aqui)
```

### Source Code (repository root)

```text
src/
├── main.ts                          # passa a usar o setup compartilhado (setupApp)
├── app.setup.ts                     # NOVO: prefixo, helmet, CORS, pipe, filtro (reusado por main e testes)
├── cli.ts                           # NOVO: entrypoint do nest-commander (TRV-09)
├── cli/create-admin.command.ts      # NOVO
├── config/
│   ├── env.schema.ts                # AMPLIADO: Redis, Vault, S3, SMTP, ClamAV, segredos, regras de produção
│   └── logger.config.ts             # AMPLIADO: destino de log injetável (captura em teste)
├── common/
│   ├── http/
│   │   ├── http-exception.filter.ts # NOVO (TRV-01)
│   │   ├── api-error.ts             # NOVO
│   │   ├── route-decorators.ts      # NOVO: @PublicApi, @AdminApi (TRV-07)
│   │   └── no-store.interceptor.ts  # NOVO: no-store nas duas áreas e remoção de Set-Cookie nas públicas
│   ├── validation/
│   │   ├── schemas.ts               # NOVO: text({max}), uuid(), strictObject padrão (TRV-02)
│   │   └── validation-error.mapper.ts
│   └── pagination/
│       ├── cursor.ts                # NOVO (TRV-08)
│       └── page.schema.ts
├── infra/
│   ├── vault/                       # NOVO (TRV-04)
│   │   ├── vault.module.ts
│   │   ├── vault.client.ts
│   │   ├── vault-auth.ts
│   │   └── key-service.errors.ts
│   ├── queue/                       # NOVO (TRV-05)
│   │   ├── queue.module.ts
│   │   ├── job-defaults.ts
│   │   └── job-payload.schema.ts
│   └── storage/                     # NOVO (TRV-06)
│       ├── storage.module.ts
│       └── storage.service.ts
└── modules/
    ├── users/users.repository.ts    # NOVO (USERS-01)
    ├── auth/password/               # NOVO (mínimo para TRV-09, Q-P1)
    │   ├── password-hasher.provider.ts  # factory do PasswordHasher (scrypt) do @nestjs/authentication
    │   ├── password-policy.ts
    │   └── common-passwords.txt
    └── audit/                       # NOVO (núcleo da AUDIT-02, Q-P2)
        ├── audit.service.ts
        └── audit-hash.ts

src/scripts/export-openapi.ts        # NOVO (TRV-11): npm run openapi:export (compilado para dist/)

openapi/                             # NOVO (TRV-11): contrato versionado, lido pelo api:sync do front
├── public.json                      # só /api/public/v1/*
└── admin.json                       # só /api/admin/v1/*

test/support/                        # NOVO (TRV-10)
├── global-setup.ts                  # migrations no banco-modelo
├── test-database.ts                 # clona e descarta o banco por suíte
├── test-app.ts                      # sobe o app com setupApp
├── factories.ts                     # usuário com perfis, categoria, denúncia cifrada
└── log-capture.ts

docs/
├── adr/README.md                    # D27 a D33
└── deploy/
    ├── proxy.md                     # NOVO (TRV-12)
    └── nginx/canal-denuncias.conf

.github/workflows/ci.yml             # AMPLIADO: roda openapi:export, falha se openapi/ divergir e publica artefato
docker-compose.yml                   # AMPLIADO: bucket de dev e variáveis novas
.env.example                         # AMPLIADO
```

**Arquivos acrescentados durante a implementação** (pendência U2 do analyze):

```text
src/config/env.validate.ts, src/config/log-destination.ts
src/common/http/no-store.interceptor.ts
src/infra/vault/key-service.ts, src/infra/vault/vault-http.ts
src/infra/queue/redis.connection.ts
src/cli/password-prompt.ts, src/cli/cli-output.ts, src/cli/cli-commands.module.ts, src/cli/cli.module.ts
test/support/db-urls.ts, test/support/test-env.ts, test/support/README.md, test/support/fixtures/*
docs/deploy/nginx/smoke-test.sh
```

**Structure Decision**: projeto único (API NestJS). Os componentes técnicos sem regra de negócio (Vault, fila,
storage) ficam em `src/infra/`. As convenções HTTP, validação e paginação ficam em `src/common/`. O que pertence a um
módulo de domínio (repositório de usuários, hash de senha, auditoria) fica no módulo dono, já na pasta definitiva,
para que as features users, auth e audit só acrescentem código. Um `app.setup.ts` compartilhado garante que testes e
produção usem a mesma configuração (FR-032).

## Complexity Tracking

| Violation                                                                                    | Why Needed                                                                                                                       | Simpler Alternative Rejected Because                                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Escopo além do arquivo 00 (USERS-01, núcleo da AUDIT-02, `PasswordHasher` do pacote oficial) | A TRV-09 entrou na feature (Q1) e depende de repositório de usuários, hash de senha e auditoria na mesma transação (princípio V) | Gravar o admin direto no banco sem auditoria viola o princípio V. Adiar a TRV-09 contradiz a Q1                             |
| Cliente próprio do Vault em vez de biblioteca                                                | Os erros do `node-vault` (axios) carregam o corpo da requisição, que contém plaintext e chaves (princípio II)                    | Blindar a biblioteca exigiria interceptar e sanitizar todo erro do axios, com mais código e risco do que 6 chamadas `fetch` |
