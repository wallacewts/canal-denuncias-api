# Implementation Plan: Decisão das bibliotecas de autenticação e autorização

**Branch**: `main` (sem branch de feature) | **Date**: 2026-11-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-auth-library-decision/spec.md`

## Summary

Decidir e provar as bibliotecas de autenticação e autorização antes dos módulos 03-users, 04-auth e
05-access-control. Decidido pelo usuário (Q-P1 = A), com base na API instalada e em experimento com relógio controlado
(`research.md`): pacotes oficiais do Nest 12, `@nestjs/authentication` 0.1.8 (já usado no hash, D32) com sessão por
cookie, MFA TOTP e guard global, e `@nestjs/authorization` 0.1.4 com políticas, `@Can()` e negação por padrão. Só
sessão por cookie no servidor, sem tokens de renovação nem tokens portadores (Q-P2 revista para A, R3). As lacunas
são de **armazenamento e integração**: stores em Postgres para sessões e MFA, o segredo TOTP selado pelo
`AppSecretService` (Vault, `app-kek`), a ponte da sessão para a porta `AUTH_IDENTITY` (D47) e o filtro de listagem
derivado da mesma regra da política. Pela Q1 (opção C), os dois stores, a migration e a ponte de identidade são
**definitivos** em `src/`; login, MFA, rotas e políticas de exemplo ficam como **teste de contrato** em `test/`.

## Technical Context

**Language/Version**: TypeScript em Node.js 26.13.1 (ESM), NestJS 12

**Primary Dependencies**: `@nestjs/authentication` 0.1.8 (já instalado, versão exata), `@nestjs/authorization` 0.1.4
(novo, versão exata), TypeORM 1.x, zod 4. Nenhuma outra dependência e nenhum segredo novo.

**Storage**: PostgreSQL 18. Migration à mão `AuthStores` ajusta `sessions`, `users` (colunas de MFA) e
`recovery_codes`, e cria `mfa_failures` (`data-model.md`).

**Testing**: Vitest (unitário e e2e com Postgres real por suíte), `authenticationStoreContract()` do pacote contra os
stores Postgres, relógio injetado (`now`) para expirações e TOTP.

**Target Platform**: container Linux (imagem da API), on-premise.

**Project Type**: web-service (API NestJS).

**Performance Goals**: uma leitura por requisição autenticada (sessão com o usuário na mesma consulta, `extra`), escrita
de atividade no máximo 1 vez por minuto por sessão (`touchInterval: '1m'`).

**Constraints**: sessão expira em 15 min sem uso e 8 h no máximo; cookie `__Host-sid` `HttpOnly`, `Secure`,
`SameSite=Strict`; nada em memória em produção; nenhuma chamada ao Vault dentro de transação; área pública sem cookie
de sessão; nenhum token portador (só o cookie de sessão autentica).

**Scale/Scope**: equipe interna pequena (dezenas de usuários); 2 decisões no ADR, 2 stores, 1 ponte de identidade, 1
migration e as suítes de contrato.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- [x] I. Anonimato: nenhuma rota pública nova; `@PublicApi` passa a compor `@Public()`, então o guard global não lê nem
      emite cookie na área pública. Os dados de sessão (IP, user-agent) são só da equipe interna (D25, CHECK de IP
      da trilha continua). Token de sessão só no cookie, nunca no corpo nem na URL; não existe token portador.
- [x] II. Minimização: a sessão guarda só o hash do token, o usuário, os horários, o estado do MFA e IP/user-agent da
      equipe. Nenhuma senha, código ou token em log, metadata de auditoria ou mensagem de erro.
- [x] III. Criptografia: o segredo TOTP é selado pelo `AppSecretService` (Vault, `app-kek`, preso ao usuário); a
      cifragem local do pacote fica desligada (`encryption: false`) para não haver chave fora do Vault (R1). Tokens de
      sessão só como hash SHA-256 (feito pelo pacote). Nenhum segredo novo fora do Vault. Nenhum uso da `identity-kek`.
- [x] IV. Acesso: guard global de autenticação e guard global de autorização com negação por padrão (rota sem regra →
      403, listada na inicialização); escopo das listagens no `WHERE` pela mesma função de escopo da política (R6);
      `AdminIdentityGuard` (D47) mantido; só o cookie de sessão autentica a área administrativa. DPO lê sem tratar e ninguém altera os próprios perfis provados em teste.
- [x] V. Auditoria: `AUTH_SIGNED_IN` e `ACCESS_DENIED` gravados (e as demais ações de autenticação
      no catálogo) pelo `AuditService` a partir dos eventos dos pacotes,
      no contexto da requisição (D46), sem segredo na metadata. Nada altera `audit_logs`.
- [x] VI. Banco: as escritas atômicas exigidas pelos contratos (`touchSession`, `deleteSession`, `saveTotp`,
      `claimTotpStep`, `consumeRecoveryCode`, `recordMfaFailure`) são uma instrução cada, com `UNIQUE`/`CHECK` onde
      cabe; migration `AuthStores` à mão com `down()`; entidades ajustadas e a nova (`MfaFailure`) em `entities.ts`.
- [x] VII. Testes: cada cenário das US2 a US4 e cada método dos contratos tem teste escrito antes, contra o Postgres
      (inclusive concorrência do contrato do pacote e valores curtos nos testes de não vazamento).
- [x] VIII. Qualidade: pacote oficial avaliado antes do de terceiros (princípio VIII); versões exatas; segredos de teste
      fictícios. Risco do 0.1.x registrado com mitigação (R1). Ver Complexity Tracking.
- [x] IX. Simplicidade: entrega só a decisão, os stores definitivos e a ponte de identidade; rotas e políticas reais
      ficam para 04-auth e 05-access-control. As decisões entram em `docs/adr/README.md` como D53 (autenticação, sem
      renovação por tokens) e D54 (autorização), na primeira tarefa.

**Re-check após o design (Phase 1)**: todos os portões continuam ✅. O experimento confirmou no pacote instalado os
três pontos que poderiam exigir código próprio de segurança (expiração por inatividade e absoluta, replay de TOTP e
cookie `__Host-`), então as extensões ficam restritas a persistência e integração.

## Decisões do usuário

- **Q-P1 = A** (2026-11-28): pacotes oficiais para toda a autenticação e autorização, com versão exata, suíte de
  contrato contra os stores Postgres e saída pela `AUTH_IDENTITY`.
- **Q-P2 revista = A** (2026-11-28): primeiro o usuário escolheu manter a renovação (B); ao ver que ela virava um
  canal separado para clientes que não são navegador, que hoje ninguém usa, decidiu tirá-la. Só sessão por cookie no
  servidor (FR-010, cenário 7 da US2 e SC-005 reescritos). Um canal de tokens pode ser criado no futuro, por decisão
  própria (R3).

## Project Structure

### Documentation (this feature)

```text
specs/004-auth-library-decision/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── auth-integration.md
│   └── stores.md
└── tasks.md             # (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── common/http/route-decorators.ts       # @PublicApi compõe @Public(); @AdminApi exige MFA; OpenAdminRoute()
├── infra/auth/
│   ├── auth-infra.module.ts              # AuthenticationModule + AuthorizationModule; AdminAreaGuardModule por último
│   ├── auth-identity.port.ts             # (existente) porta D47
│   ├── admin-identity.guard.ts           # (existente) pula rotas OpenAdminRoute
│   ├── auth-clock.ts                     # novo: AUTH_CLOCK (relógio injetável da sessão e do MFA)
│   ├── auth-storage.provider.ts          # novo: registra os stores no AuthenticationStorage
│   ├── staff-user.ts                     # novo: tipo do usuário da sessão (augmentation do pacote)
│   ├── session-auth-identity.ts          # novo: AUTH_IDENTITY a partir da sessão (lê request.user)
│   ├── staff-session.provider.ts         # novo: SessionCookieProvider (carrega usuário e perfis)
│   ├── auth-audit.subscriber.ts          # novo: eventos → AuditService (AUTH_*, ACCESS_DENIED)
│   └── stores/
│       ├── pg-session.store.ts           # novo, definitivo
│       └── pg-mfa.store.ts               # novo, definitivo (sela o segredo com AppSecretService)
├── modules/auth/entities/                # session.entity.ts ajustada, mfa-failure.entity.ts nova
├── modules/users/entities/user.entity.ts # colunas de MFA
└── database/migrations/<ts>-AuthStores.ts

test/
├── support/auth-clock.ts                 # TestClock para o AUTH_CLOCK
└── contract/auth/
    ├── auth-stores.migration.e2e-spec.ts # migration AuthStores (up/down)
    ├── store-contract.e2e-spec.ts        # authenticationStoreContract() contra os stores Postgres
    ├── pg-mfa-store.e2e-spec.ts          # selagem pelo Vault, fora de transação
    ├── public-area.e2e-spec.ts           # área pública com os guards globais
    ├── example/                          # módulo só de teste: login, MFA, rota protegida, políticas, escopo
    ├── sign-in-mfa.e2e-spec.ts           # US2
    ├── session-expiry.e2e-spec.ts        # US2 (relógio)
    ├── authorization.e2e-spec.ts         # US3
    └── integration.e2e-spec.ts           # US4
```

**Structure Decision**: projeto único. Definitivo em `src/infra/auth`, `src/modules/{auth,users}/entities` e na
migration; teste de contrato em `test/contract/auth` (nunca importado por `src/`, teste de convenção existente).

## Complexity Tracking

| Violação                                                                  | Por que é necessária                                                                                                                                                     | Alternativa mais simples rejeitada porque                                                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pacotes de segurança em 0.1.x (princípio VIII pede estabilidade da stack) | São os únicos que entregam, sem código próprio de segurança, expiração absoluta, replay e bloqueio de TOTP, códigos de recuperação, tempo constante e negação por padrão | Passport + CASL exigiriam escrever essas partes como código próprio de segurança (a estimativa inicial de ~600 linhas incluía a renovação por tokens, que saiu na Q-P2) sobre bibliotecas sem atualização recente (`passport-local` 2023) |
| `mfa.encryption: false` no pacote                                         | A selagem é feita pelo store com o Vault (`app-kek`), para não haver chave estática fora do Vault                                                                        | A cifragem local do pacote exige chave em variável de ambiente, contra D08 e o princípio III                                                                                                                                              |
