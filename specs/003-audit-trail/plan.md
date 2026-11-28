# Implementation Plan: Trilha de auditoria completa

**Branch**: `main` (sem branch de feature, decisão do usuário) | **Date**: 2026-11-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-audit-trail/spec.md`

## Summary

Completar a trilha de auditoria cobrindo AUDIT-01 e AUDIT-03 a AUDIT-09 (`docs/tarefas/02-audit.md`), sobre o núcleo
de gravação com cadeia de hash da feature 001 (D33):

- catálogo fechado de ações e tipos de recurso, com metadata validada por ação, sem texto livre (R1);
- ator determinado pelo contexto da requisição, job ou comando, que o módulo não consegue informar nem sobrescrever
  (R2), e a área administrativa negada por padrão até a autenticação existir (R3);
- `@Audited` para leituras e casos simples, com resultado sucesso, negado ou falha (R4);
- consulta da trilha pelo Auditor com cursor decrescente (R5) e verificação da cadeia em lotes, por rota e por
  comando (R6);
- suíte automatizada de imutabilidade (AUDIT-08);
- guarda de 5 anos: tabela particionada por mês (R7), expurgo por remoção de partição inteira com funções restritas a
  um perfil próprio (R8), âncora da cadeia depois do expurgo (R9), criação antecipada de partições (R10) e migração da
  tabela atual (R11).

Sem dependência nova. Uma migration nova, uma tabela nova (`audit_purges`), um perfil de banco novo
(`app_audit_maintenance`), duas rotas administrativas e dois comandos de CLI.

## Technical Context

**Language/Version**: TypeScript 6 sobre Node.js 26.13.1 (`.tool-versions`), ESM.

**Primary Dependencies**: as já instaladas. NestJS 12, TypeORM 1.1, zod 4.6.7 (schemas de metadata e de filtros),
`nest-commander` 3.21.0, `node:async_hooks` (`AsyncLocalStorage`) e `node:crypto` (sha256 da cadeia, já usado).
**Nenhuma dependência nova.**

**Storage**: PostgreSQL 18. `audit_logs` passa a ser particionada por mês em `occurred_at`; nova tabela `audit_purges`;
funções `SECURITY DEFINER` de manutenção. Ver [data-model.md](./data-model.md) e
[contracts/partitioning.md](./contracts/partitioning.md).

**Testing**: Vitest. Unitários para catálogo, schemas de metadata, contexto, interceptor, cursor e verificação (cadeia
em memória). Integração contra o Postgres do docker-compose com banco clonado por suíte (harness da 001): contexto do
ator por área de rota, `@Audited`, consulta, verificação com adulteração, imutabilidade por perfil e por partição,
migração com cadeia preservada, expurgo, âncora e recusas. Fixture de 100.000 registros para medir SC-006 e SC-007.

**Target Platform**: container Linux (`node:26-alpine`), on-premise. O comando `audit-maintenance` roda por agendador
do sistema, fora do processo da API.

**Project Type**: web-service (API NestJS) com CLI administrativa.

**Performance Goals**: verificação de 100.000 registros em menos de 1 minuto, com memória constante (SC-006); primeira
página da consulta com filtros em menos de 1 segundo com 100.000 registros (SC-007). Limites aplicados só fora do CI;
no CI os valores são medidos e registrados (D41).

**Constraints**:

- Ninguém altera nem apaga registro da trilha; a única remoção é de partição inteira com mais de 5 anos, por função
  restrita ao perfil de manutenção.
- `record()` não aceita ator, usuário, IP nem user-agent; fora de contexto, recusa.
- Metadata só com identificadores, códigos, números, datas e booleanos; recusas sem ecoar valores.
- A área administrativa responde 401 para todos até a AUTH-06 trocar a porta de identidade.
- A checagem de divergência entre entidades e banco do CI continua sem diferenças.

**Scale/Scope**: volume atual pequeno (dezenas de registros por dia em desenvolvimento); desenho dimensionado para
milhões de registros por ano, com uma partição por mês e 60 meses de guarda.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Confira cada portão contra `.specify/memory/constitution.md`. Marque ✅ ou explique a violação em "Complexity Tracking".

- [x] I. Anonimato: registros feitos em rotas públicas saem com ator denunciante, sem usuário, IP nem user-agent,
      determinados pelo contexto (R2); os cabeçalhos da requisição pública nunca são lidos, e a CHECK do banco continua
      recusando IP de denunciante. Nenhuma rota pública nova. Os filtros da consulta são identificadores, códigos e
      datas.
- [x] II. Minimização: a feature **reforça** o princípio: catálogo fechado e metadata sem texto livre (R1), recusas com
      mensagem fixa e sem valor. Nada novo é coletado; a trilha passa a ser removida depois de 5 anos.
- [x] III. Criptografia: a trilha não guarda conteúdo, por isso não tem campo cifrado; a feature não usa chaves.
- [x] IV. Acesso: as rotas da trilha exigem identidade (401 sem ela, R3) e o perfil `AUDITOR` (403 para os demais). As
      funções de manutenção só executam pelo perfil `app_audit_maintenance`; `app_runtime` perde `EXECUTE` nelas e
      `UPDATE`/`DELETE`/`TRUNCATE` em cada partição (R8).
- [x] V. Auditoria: consulta, verificação e expurgo geram registro (`AUDIT_LOG_VIEWED`, `AUDIT_CHAIN_VERIFIED`,
      `AUDIT_LOG_PURGED`); o expurgo grava o `AUDIT_LOG_PURGED` na **mesma transação** da remoção da partição. Nada
      altera registro da trilha: a remoção de partição inteira com mais de 5 anos é o mecanismo de retenção decidido
      pelo usuário (FR-028), feito por função restrita, com âncora conferida pela verificação (R9). Ver Complexity
      Tracking.
- [x] VI. Banco: a imutabilidade continua no banco (gatilho de linha herdado, gatilho de `TRUNCATE` e `REVOKE` em cada
      partição, CHECK de IP). A migration `AuditLogPartitioning` é escrita à mão, com conferência de contagem e último
      hash e `down()` funcional. A entidade `AuditLog` é ajustada (PK composta) e continua em `entities.ts`; a
      entidade nova `AuditPurge` entra lá.
- [x] VII. Testes: cada regra (catálogo, metadata, ator por área, não sobrescrita, `@Audited`, 401/403, verificação com
      adulteração e remoção, imutabilidade por perfil e por partição, recusa de expurgo recente, âncora forjada,
      migração) tem teste escrito antes, inclusive com valores curtos (`XQZ`).
- [x] VIII. Qualidade: stack fixa e sem dependência nova. Credenciais do perfil de manutenção são fictícias de
      desenvolvimento, como as demais.
- [x] IX. Simplicidade: só as tarefas pedidas (AUDIT-01, 03 a 09). Alertas, tela do Auditor e exportação ficam fora.
      As decisões D45 a D51 entram em `docs/adr/README.md` como primeira tarefa.

**Re-check após o design (Phase 1)**: todos os portões continuam ✅. O design confirmou, com teste no Postgres 18 local,
os três pontos que exigiam cuidado: o gatilho de `TRUNCATE` não é herdado pelas partições, os privilégios padrão
concederiam `DELETE` ao `app_runtime` em cada partição nova e as funções recebem `EXECUTE` padrão para `app_runtime`.
Os três são tratados explicitamente (R8, R10, R12) e cobertos por teste. A única exceção registrada é a remoção de
partição, abaixo.

## Project Structure

### Documentation (this feature)

```text
specs/003-audit-trail/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── audit-module.md          # AuditService.record(), AuditContext, @Audited, erros
│   ├── audit-catalog.md         # ações, tipos de recurso e formato de metadata por ação
│   ├── admin-audit-api.md       # GET /audit-logs e POST /audit-logs/verification
│   ├── cli-audit.md             # verify-audit e audit-maintenance
│   └── partitioning.md          # tabela particionada, funções, perfis, âncora e migração
└── tasks.md                     # gerado por /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── common/
│   ├── http/route-decorators.ts            # já existe; a área da rota alimenta o AuditContext
│   └── pagination/cursor-desc.ts           # novo: paginação decrescente sobre id bigint
├── infra/auth/
│   ├── auth-identity.port.ts               # novo: porta AUTH_IDENTITY (padrão devolve null)
│   └── admin-identity.guard.ts             # novo: 401 sem identidade na área admin
├── modules/audit/
│   ├── audit-action.enum.ts                # novo: catálogo de ações e tipos de recurso
│   ├── audit-metadata.schemas.ts           # novo: schema de metadata por ação
│   ├── audit-context.ts                    # novo: AsyncLocalStorage, runAsSystem
│   ├── audit-context.interceptor.ts        # novo: abre o contexto por área de rota
│   ├── audit.service.ts                    # já existe: passa a usar catálogo, schema e contexto
│   ├── audit-hash.ts                       # já existe
│   ├── audited.decorator.ts                # novo
│   ├── audit.interceptor.ts                # novo
│   ├── audit-verifier.service.ts           # novo: verificação em lotes com âncora
│   ├── audit-query.service.ts              # novo
│   ├── audit-maintenance.service.ts        # novo: chama as funções de partição e expurgo
│   ├── audit.controller.ts                 # novo: consulta e verificação
│   └── entities/
│       ├── audit-log.entity.ts             # ajustada: PK (id, occurred_at), sem índice único em hash
│       └── audit-purge.entity.ts           # nova
├── cli/
│   ├── verify-audit.command.ts             # novo
│   └── audit-maintenance.command.ts        # novo
└── database/migrations/
    └── <ts>-AuditLogPartitioning.ts        # nova, escrita à mão

test/
├── audit/                                  # catálogo, contexto, @Audited, consulta, verificação,
│                                           # imutabilidade, partições, expurgo, âncora, migração, desempenho
└── support/fake-identity.ts                # identidade só de teste

docs/deploy/audit/README.md                 # runbook: agendamento, perfil de manutenção, verificação
docker/postgres/01-roles.sh                 # + app_audit_maintenance
```

**Structure Decision**: tudo dentro do módulo `audit` existente, mais a porta de identidade em `src/infra/auth` (que a
AUTH-06 vai implementar) e um utilitário de paginação decrescente em `src/common/pagination`.

## Complexity Tracking

| Violation                                                                            | Why Needed                                                                                                                    | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remoção de partições inteiras da trilha, que o princípio V descreve como append-only | O usuário decidiu guardar a trilha por 5 anos com expurgo automático (Q2 = B, FR-028); a LGPD pede eliminação ao fim do prazo | `DELETE` linha a linha exigiria desligar o gatilho de imutabilidade; manter a trilha para sempre contraria a decisão. A remoção só alcança partições com mais de 5 anos, sempre do início, por função restrita a um perfil próprio, registrada na mesma transação e conferida pela âncora (R8, R9) |
| Restrição única de `hash` removida                                                   | Toda restrição única de tabela particionada precisa incluir a chave de partição                                               | Manter a tabela sem partição impediria o expurgo por período. A unicidade nunca foi a proteção da cadeia; a verificação detecta duplicação ou troca (R6)                                                                                                                                           |

## Decisões do usuário

- **Q1 (2026-11-28)**: a AUDIT-09 entra inteira (opção C).
- **Q2 (2026-11-28)**: a trilha é guardada por 5 anos após o registro, com expurgo automático (opção B). Precisa ser
  validado com o jurídico e o DPO e constar no RIPD.
