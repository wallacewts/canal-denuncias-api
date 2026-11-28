# Implementation Plan: Gestão da equipe interna e meu perfil

**Branch**: `main` (sem branch: não há hook de git) | **Date**: 2026-11-28 | **Spec**:
[spec.md](spec.md)

**Input**: Feature specification from `specs/005-team-user-management/spec.md`

## Summary

Rotas administrativas de gestão da equipe (USERS-02 a USERS-06: cadastrar com senha provisória exibida uma vez, listar,
detalhar, alterar nome, status e perfis, resetar MFA de outra pessoa) e o `GET /me` (USERS-07) no formato que o front
do backoffice já usa. Tudo sobre o que existe: repositório de usuários (001), sessão, guards e stores (004), auditoria
com ator por contexto (003). A abordagem: um catálogo único de habilidades `recurso.ação` em código, de onde saem o
`/me` e as regras do servidor, com testes de concordância contra a matriz do ACL-01; transações com trava para "nunca
sem Administrador ativo" e para a regra das denúncias atribuídas (Q1 = A); revogação de sessões pelo `revokeAll` do
pacote depois do commit.

## Technical Context

**Language/Version**: TypeScript em Node.js 26.13.1 (ESM), NestJS 12

**Primary Dependencies**: `@nestjs/authentication` 0.1.8 e `@nestjs/authorization` 0.1.4 (já instalados, versões
exatas), TypeORM 1.x, zod 4. Nenhuma dependência nova (QR, e-mail etc. não entram).

**Storage**: PostgreSQL 18. **Nenhuma migration**: só tabelas e colunas existentes (`data-model.md`).

**Testing**: Vitest; e2e com Postgres real por suíte e `createTestApp({ vault: 'api' })`; sessões reais pelo login de
exemplo da feature 004 (só de teste); `TestClock` no `AUTH_CLOCK` para os horários de expiração; captura de log para
"não vazou" (com trecho curto, ex. `XQZ`).

**Target Platform**: container Linux (imagem da API), on-premise.

**Project Type**: web-service (API NestJS).

**Performance Goals**: equipe de dezenas de pessoas; listagem paginada por cursor (até 100 por página); `/me` com uma
consulta ao usuário (nome, e-mail, MFA e troca de senha não vêm com a sessão) e nenhuma consulta para as habilidades
(catálogo em código).

**Constraints**: corte de acesso na primeira requisição seguinte ao bloqueio/desativação; nunca zero Administradores
ativos, mesmo com operações simultâneas; senha provisória nunca em log/trilha/erro; nenhuma chamada ao Vault (nada é
cifrado aqui; o reset só apaga dado selado); contrato do `/me` idêntico ao `CurrentUser` do front.

**Scale/Scope**: 8 rotas, 1 política, 1 catálogo de habilidades, 1 assinante (último login), ajustes de 2 schemas de
auditoria e do corpo de erro; 4 user stories.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- [x] I. Anonimato: nenhuma rota pública tocada; só rotas `@AdminApi`; caminhos só com o UUID da pessoa (nenhum e-mail
      ou dado pessoal na URL).
- [x] II. Minimização: só nome, e-mail profissional, perfis e status da equipe; senha provisória só em trânsito, uma
      vez; metadata da trilha só com enums (perfis, status, nome do campo alterado), nunca nome, e-mail ou senha;
      nenhuma telemetria.
- [x] III. Criptografia: nenhum dado novo a cifrar; segredo de MFA (já selado pela `app-kek`) só é apagado; senhas só
      como hash (D32); a API não usa a `identity-kek`; nenhuma chamada ao Vault dentro de transação.
- [x] IV. Acesso: toda rota declara permissão (`@Can(UsersPolicy, …)` ou `@Can.Anyone()` no `/me`); só `ADMIN`
      gerencia a equipe; ninguém age sobre si mesmo nos perfis, status ou MFA (D21); negação registrada; não há
      listagem de denúncias (escopo no `WHERE` não se aplica; a contagem de atribuídas é só interna).
- [x] V. Auditoria: `USER_CREATED`, `USER_UPDATED`, `USER_STATUS_CHANGED`, `USER_ROLES_CHANGED` e `USER_MFA_RESET` na
      mesma transação da alteração, ator do contexto; nada altera `audit_logs`. A revogação de sessões (após o commit)
      não é ação nova: é efeito da mudança de status ou do reset, já registrados.
- [x] VI. Banco: unicidade do e-mail pela constraint existente; regras entre linhas ("um Administrador ativo",
      "atribuídas") em transação com trava (advisory lock e `FOR UPDATE`), justificado em research R3/R4; sem
      migration nova.
- [x] VII. Testes: cada regra de segurança (403 contra si mesmo, último Administrador sob concorrência, revogação
      imediata, senha provisória não vaza, concordância catálogo × servidor × matriz) tem teste escrito antes, que
      falha se a regra quebrar.
- [x] VIII. Qualidade: stack fixa, sem dependência nova; lint, tipos, testes, build e `openapi:export` verdes; sem
      segredo no repositório.
- [x] IX. Simplicidade: só USERS-02 a 07; as políticas das denúncias ficam para o ACL. Duas decisões novas (catálogo de
      habilidades como fonte única; `code`/`details` no corpo de erro) entram em `docs/adr/README.md` (D55, D56) na
      primeira tarefa, antes do código.

**Re-check após o design (Phase 1)**: todos os portões continuam ✅. O design não exige migration, não adiciona
dependência e mantém a auditoria na transação (o reset do MFA usa um método do store dentro da transação em vez do
`MfaService.disable`, research R6).

## Project Structure

### Documentation (this feature)

```text
specs/005-team-user-management/
├── plan.md
├── research.md           # R1–R10
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── users-api.md      # USERS-02 a 06
│   └── me-api.md         # USERS-07, igual ao CurrentUser do front
├── checklists/requirements.md
└── tasks.md              # (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── common/http/api-error.ts                      # code? e details? opcionais (R8)
├── common/http/http-exception.filter.ts          # repassa code/details de exceções de domínio
├── common/http/domain-error.ts                    # DomainConflictError (409 com code/details)
├── modules/access-control/
│   ├── abilities.ts                              # catálogo único recurso.ação, abilitiesFor, hasAbility (R1)
│   └── policies/users.policy.ts                  # manage, actOnOther (R10)
├── modules/audit/
│   ├── audit.controller.ts                       # checagem do Auditor via catálogo (audit.read)
│   └── audit-metadata.schemas.ts                 # USER_UPDATED novo; USER_CREATED.forced opcional
├── modules/users/
│   ├── users.controller.ts                       # rotas de equipe
│   ├── me.controller.ts                          # GET /me
│   ├── users.service.ts                          # transações, travas, revokeAll
│   ├── users.schemas.ts                          # entrada (strictObject) e saída
│   ├── temporary-password.ts                     # geração (R5)
│   ├── admin-lock.ts                             # chave do advisory lock (movida do create-admin)
│   ├── last-login.subscriber.ts                  # last_login_at (R9)
│   └── users.repository.ts                       # (existente) + list, update, assigned count
├── infra/auth/stores/pg-mfa.store.ts             # + resetFor(userId, manager) (R6)
└── cli/create-admin.command.ts                   # usa admin-lock.ts

test/users/
├── support.ts                                    # sessões pelo login de exemplo da 004
├── users-create-list.e2e-spec.ts                 # US1
├── last-login.e2e-spec.ts                        # US1 (último login)
├── me.e2e-spec.ts                                # US2
├── abilities-concordance.e2e-spec.ts             # US2 (catálogo × servidor)
├── users-status.e2e-spec.ts                      # US3 (+ concorrência)
├── users-roles-name.e2e-spec.ts                  # US3
└── users-mfa-reset.e2e-spec.ts                   # US4
src/modules/access-control/abilities.spec.ts       # tabela + documento × catálogo
```

**Structure Decision**: projeto único. Regras de autorização no `access-control` (pasta prevista no ACL-01), operações
no `users`. Sessões nos testes pelo módulo de exemplo da feature 004 (nunca importado por `src/`).

## Complexity Tracking

| Violação                                                      | Por que é necessária                                                                                    | Alternativa mais simples rejeitada porque                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Regras entre linhas em transação com trava, não em constraint | "Ao menos um Administrador ativo" e "sem denúncias abertas atribuídas" envolvem várias linhas e tabelas | Trigger seria difícil de testar e de traduzir no 409 com código; `SERIALIZABLE` exigiria retentativa geral |
| Catálogo de habilidades devolvido antes das políticas do ACL  | O front precisa dos códigos estáveis agora (Q2 = A)                                                     | Devolver só o que já tem regra mudaria o contrato a cada feature                                           |
