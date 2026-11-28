# Implementation Plan: Controle de acesso — políticas reais da matriz de permissões

**Branch**: `main` (sem branch: não há hook de git; decisão do usuário) | **Date**: 2026-11-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/007-access-control-policies/spec.md`

## Summary

Políticas reais da matriz do ACL-01 (ACL-01 a ACL-05) sobre o pacote `@nestjs/authorization` e o catálogo único de
habilidades. O alcance por registro (todas ou só as atribuídas) é declarado uma vez no catálogo (`recordScope`) e
interpretado por uma função de escopo única (`report-scope.ts`): o filtro da listagem no `WHERE`
(`scopeReportsFor`) e a decisão sobre um registro (`allowsReport`), com concordância provada por teste exaustivo no
Postgres. Denúncia por id passa por um único `ReportAccessService.resolve`: mesma consulta e mesma escrita na trilha
para "fora do escopo" e "inexistente" (404 idêntico, `ACCESS_DENIED` com motivo, Q2 = B), escopo antes do expurgo
(410 só dentro do escopo, Q1 = B). Negações do guard passam a gravar o código do catálogo e o tipo de recurso; a
rota da trilha deixa a checagem manual e declara `audit.read`; um teste de convenção percorre as rotas registradas.
Sem migration e sem rota nova; o uso pelas rotas reais de denúncias fica para as features de domínio.

## Technical Context

**Language/Version**: TypeScript em Node.js 26.13.1 (ESM), NestJS 12

**Primary Dependencies**: `@nestjs/authorization` 0.1.4 e `@nestjs/authentication` 0.1.8 (já instalados, versões
exatas); `DiscoveryService`/`MetadataScanner` do `@nestjs/core` no teste de convenção. Nenhuma dependência nova.

**Storage**: PostgreSQL 18; leitura de `reports`, `report_access_blocks`, `identity_reveal_requests`; escrita só em
`audit_logs` (pelo `AuditService`). Nenhuma migration (research R9).

**Testing**: Vitest; unitário em tabela da matriz; e2e com Postgres real (`createTestApp`, sessão real pelas rotas
de login onde há política sobre a sessão; rota só de teste em `test/support/fixtures/` para o `resolve`); teste de
tempo isolado em `*.timing-spec.ts` (`npm run test:timing`, já existente).

**Target Platform**: container Linux (imagem da API), on-premise.

**Project Type**: web-service (API NestJS).

**Performance Goals**: listagem com uma consulta só (sem consulta por denúncia); `resolve` com uma consulta por
chave primária mais, na negação, uma escrita na trilha.

**Constraints**: escopo sempre no `WHERE`; mesma consulta e escrita para os dois 404; nenhum conteúdo de denúncia lido
ou decifrado para decidir acesso; catálogo e `GET /me` inalterados; nenhum `@Can.Anyone()` em rota de denúncia.

**Scale/Scope**: 12 habilidades, 5 perfis, 8 políticas (1 existente), 1 serviço de acesso, 1 rota migrada, 5 user
stories, sem rota nova.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

**Antes da pesquisa (Phase 0)**:

- [x] I. Anonimato: nenhuma rota pública tocada; nas rotas administrativas, só o id da denúncia (UUID) no caminho,
      já previsto; o 404 idêntico não revela existência, nem para denúncia expurgada (Q1 = B).
- [x] II. Minimização: as regras leem só ids, atribuição, bloqueio e `shredded_at`; metadata de `ACCESS_DENIED` só
      com nomes de código, enums e o id da denúncia; nenhuma mensagem de erro com valor recebido; nenhuma telemetria.
- [x] III. Criptografia: nenhum campo cifrado novo; a decisão de acesso acontece antes de qualquer decifragem e não
      abre chave de dados; a API não usa a `identity-kek`.
- [x] IV. Acesso: é o objeto da feature — toda rota administrativa declara permissão (teste de convenção), escopo no
      `WHERE` por função única, conflito de interesse nega para todos, ninguém altera os próprios perfis (D21,
      `UsersPolicy`), four-eyes na política da revelação (o CHECK `reveal_four_eyes` já existe no banco).
- [x] V. Auditoria: toda negação gera `ACCESS_DENIED` (`result = DENIED`) pelo `AuditService`, inclusive o 404;
      nada altera `audit_logs`.
- [x] VI. Banco: sem mudança de schema; as regras críticas já têm FK, PK composta e CHECK no banco
      (`report_access_blocks`, `reveal_four_eyes`).
- [x] VII. Testes: matriz em tabela, escopo exaustivo, cenário do ACL-03, 404/410, tempo, convenção e "não vazou"
      escritos antes e falhando primeiro.
- [x] VIII. Qualidade: stack fixa, nenhuma dependência nova, lint, tipos, testes, `test:timing` e
      `openapi:export` sem diferença.
- [x] IX. Simplicidade: só ACL-01 a 05; nada de rota de domínio; decisões novas registradas no
      `docs/adr/README.md` (D59 a D62) na primeira tarefa, antes do código.

**Re-check após o design (Phase 1)**: todos os portões continuam ✅.

- I e II: o `resolve` grava o id da denúncia como `resourceId` (UUID, inclusive o inexistente) e o motivo como enum;
  nenhum dado da pessoa denunciante, nenhum texto (data-model, metadata de `ACCESS_DENIED`).
- IV: as rotas de denúncia passam a declarar a habilidade na rota (R5), o que diminui as rotas abertas; o
  `recordScope` no catálogo mantém "políticas consultam a habilidade, nunca o perfil" (R1).
- V: negação pelo guard continua pelo assinante (fora da transação de uma operação, que não existe), negação por
  escopo pela própria chamada do `resolve`; as duas com `result = DENIED`.
- VI: confirmado no schema inicial que o four-eyes já é CHECK; nenhuma migration.
- VII: o teste de tempo é o mesmo molde do SC-002 da feature 006, isolado no `test:timing`.

## Decisões do usuário

- **Q1 = B** (FR-012): escopo primeiro; fora do escopo, 404; 410 só dentro do escopo. A frase "410 antes da política"
  do ADR 0053 é ajustada na primeira tarefa e a decisão é registrada (D59).
- **Q2 = B** (FR-018): todo 404 de denúncia grava `ACCESS_DENIED` com `reason` `OUT_OF_SCOPE` ou `NOT_FOUND`, com o
  mesmo custo e tempo (D59).
- Premissas aceitas: 403 para quem não tem nenhuma habilidade de leitura de denúncias; escopo do Analista só por
  `reports.assigned_to_id`.

## Decisões novas (registrar no `docs/adr/README.md` na primeira tarefa, conferindo antes o último número)

| #   | Tema                    | Decisão (resumo)                                                                                                                                             |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D59 | Denúncia fora do escopo | Escopo antes do expurgo (410 só dentro); 404 idêntico para fora do escopo e inexistente, ambos com `ACCESS_DENIED` e `reason`, mesma consulta e escrita (R2) |
| D60 | Escopo por registro     | `recordScope` por perfil no catálogo (aditivo); função única `report-scope.ts` com dois intérpretes (WHERE e registro), concordância provada (R1)            |
| D61 | Habilidade na trilha    | Mapa política → tipo de recurso e método → código; `ACCESS_DENIED` ganha `code` e `reason`; `resourceType` da política (R3)                                  |
| D62 | Declaração das rotas    | Rotas de denúncia declaram a habilidade na rota (403 sem ela) e o escopo no serviço (404); `@Can.Anyone()` só em lista do teste de convenção (R4, R5)        |

## Project Structure

### Documentation (this feature)

```text
specs/007-access-control-policies/
├── plan.md
├── research.md                 # R1–R9
├── data-model.md
├── quickstart.md
├── contracts/access-control.md # interface interna para as features de domínio
├── checklists/requirements.md
└── tasks.md                    # (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── modules/access-control/
│   ├── abilities.ts                     # + recordScope (aditivo, R1)
│   ├── abilities.spec.ts                # + recordScope × células "(se atribuída)" da matriz
│   ├── report-scope.ts                  # reportScope, scopeReportsFor, allowsReport (R1)
│   ├── report-access.service.ts         # resolve: 404/410 + ACCESS_DENIED com reason (R2)
│   ├── policy-abilities.ts              # política → resourceType; método → código (R3)
│   ├── access-control.module.ts         # registra políticas e exporta o ReportAccessService
│   └── policies/
│       ├── users.policy.ts              # (existente)
│       ├── reports.policy.ts
│       ├── identity-reveal.policy.ts
│       ├── retention.policy.ts
│       ├── catalog.policy.ts
│       ├── settings.policy.ts
│       ├── audit.policy.ts
│       ├── dashboard.policy.ts
│       └── matrix.spec.ts               # tabela perfil × método × situação (R8)
├── modules/audit/
│   ├── audit.controller.ts              # @Can(AuditPolicy, 'read'); sai o assertAuditor (R6)
│   └── audit-metadata.schemas.ts        # ACCESS_DENIED: + code, reason
├── infra/auth/auth-audit.subscriber.ts  # code e resourceType pelo mapa (R3)
└── common/http/domain-error.ts          # (existente) usado no 410 REPORT_SHREDDED

test/
├── access-control/
│   ├── report-scope.e2e-spec.ts         # cenário do ACL-03 + prova exaustiva (R1)
│   ├── report-access.e2e-spec.ts        # 404/410/403 e ACCESS_DENIED (R2)
│   ├── report-not-found.timing-spec.ts  # tempo dos dois 404 (R2)
│   └── audit-route.e2e-spec.ts          # rota da trilha migrada (FR-005)
├── conventions/admin-routes.e2e-spec.ts # toda rota administrativa declara permissão (R4)
├── support/fixtures/report-access-fixture.module.ts  # rota só de teste que chama o resolve
└── contract/auth/example/               # sai report-scope.ts e seu e2e; o resto usa o escopo real (R7)

docs/
├── adr/README.md                        # D59–D62
├── adr/0053-autenticacao-e-autorizacao.md  # frase do 410 e coluna "Rota" do mapeamento (R5)
└── tarefas/05-access-control.md         # critérios marcados ao concluir
```

**Structure Decision**: projeto único; tudo de autorização em `src/modules/access-control/` (como pede o backlog),
o assinante continua em `infra/auth`, a trilha no `audit`. Nenhum módulo de domínio é criado.

## Complexity Tracking

Nenhuma violação da constituição a justificar.
