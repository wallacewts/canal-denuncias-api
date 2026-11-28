# Implementation Plan: Login da equipe, MFA, senha e sessões

**Branch**: `main` (sem branch: não há hook de git) | **Date**: 2026-11-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-staff-sign-in/spec.md`

## Summary

Login real do backoffice (AUTH-01 a AUTH-05, AUTH-07, AUTH-08 e o teste do fluxo inteiro do AUTH-06): rotas de
entrada, desafio do segundo fator, primeiro acesso (troca da senha provisória e cadastro do autenticador com QR code
PNG), troca de senha com limite de 5 erros, saída e sessões da própria pessoa, proteção por origem e limite de
tentativas. Tudo sobre o pacote oficial e os stores da feature 004; o login de exemplo de `test/` vira código
definitivo em `src/modules/auth/`. Respostas no formato do contrato do front, com as decisões Q1 (422
`MFA_CODE_INVALID`) e Q2 (segundo fator antes da troca), conferidas por teste automático.

## Technical Context

**Language/Version**: TypeScript em Node.js 26.13.1 (ESM), NestJS 12

**Primary Dependencies**: `@nestjs/authentication` 0.1.8 e `@nestjs/authorization` 0.1.4 (já instalados); novas, em
versão exata: `@nestjs/throttler` 6.7.1 (limite de tentativas, R4) e `uqr` 0.1.3 (matriz do QR code, sem
dependências, R5). PNG montado com `node:zlib`. Redis já usado pela API (ioredis).

**Storage**: PostgreSQL 18 (migration `StaffSignIn`: `users.lockout_level`, `sessions.password_change_failures`);
Redis para os contadores do limite de tentativas.

**Testing**: Vitest; e2e com Postgres real por suíte e `createTestApp({ vault: 'api' })`, `TestClock` no `AUTH_CLOCK`
para bloqueios e expirações, captura de log para "não vazou" (com trecho curto), teste de tempo (SC-002) como na
feature 004, teste de contrato contra o `auth-api.md` do front (pulado sem o repositório ao lado).

**Target Platform**: container Linux (imagem da API), on-premise, atrás do proxy de referência.

**Project Type**: web-service (API NestJS).

**Performance Goals**: verificação de senha domina o tempo da entrada (scrypt); uma consulta por requisição
autenticada (já existente); limite de tentativas com uma ida ao Redis por requisição de entrada.

**Constraints**: mesma resposta e mesmo tempo para todos os erros de entrada; nenhuma senha, código, segredo ou
código de recuperação em log, trilha, erro ou URL; nada de Vault dentro de transação; 401 só para sessão ausente ou
expirada (Q1); contrato idêntico ao do front.

**Scale/Scope**: equipe de dezenas de pessoas; 10 rotas, 1 migration pequena, 2 dependências novas, 5 user stories.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- [x] I. Anonimato: nenhuma rota pública tocada; a proteção por origem e o CORS mantêm o portal sem credenciais e sem
      cookie; nada de senha, código ou e-mail na URL (o id de sessão exposto é um identificador público derivado).
- [x] II. Minimização: só o necessário da equipe (IP e navegador das sessões, para a própria pessoa reconhecê-las);
      Redis guarda só HMAC do e-mail; metadata da trilha só com códigos e inteiros; nenhuma telemetria.
- [x] III. Criptografia: segredo do autenticador selado pelo Vault (`app-kek`, store da feature 004, fora de
      transação); senhas e códigos de recuperação só como hash; a API não usa a `identity-kek`.
- [x] IV. Acesso: rotas de entrada abertas por `OpenAdminRoute()`; rotas de etapa só na etapa correspondente
      (`StepRoute`, R2); o resto exige sessão verificada; cada pessoa só vê e encerra as próprias sessões (404 para
      as de outros); ninguém troca a senha só com a senha antiga quando tem autenticador (Q2).
- [x] V. Auditoria: todos os eventos do FR-021 registrados pelo `AuthAuditSubscriber` (eventos do pacote) ou pelo
      serviço na mesma transação da alteração (troca de senha, falha de entrada, falha de troca); nada altera
      `audit_logs`.
- [x] VI. Banco: CHECK nas colunas novas; contadores com `UPDATE` condicional atômico; migration à mão com `down()`;
      entidades atualizadas.
- [x] VII. Testes: resposta genérica e tempo, bloqueio progressivo, limite de 5 erros (inclusive simultâneos), 422/423,
      código de uso único, etapas, origem, limite de tentativas e "não vazou" escritos antes e falhando primeiro.
- [x] VIII. Qualidade: versões exatas; dependências novas pequenas, sem dependências transitivas pesadas e com
      carência mínima de duas semanas; lint, tipos, testes, build e `openapi:export` verdes; sem segredo no repositório.
- [x] IX. Simplicidade: só AUTH-01 a 08; reuso do pacote e dos stores; decisões novas (R11 e o código
      `MFA_LOCKED`/`MFA_CODE_INVALID`) registradas no backlog e no `docs/adr/README.md` (D57) na primeira tarefa.

**Re-check após o design (Phase 1)**: todos os portões continuam ✅. R11 decidida (A: 403
`PASSWORD_CHANGE_REQUIRED`); números de bloqueio e limite aprovados e configuráveis por ambiente (R3, R4).

## Decisões do usuário

- **Q1 = A**: 422 `MFA_CODE_INVALID` no desafio e na confirmação; 401 só para sessão ausente ou expirada.
- **Q2 = A**: com autenticador, segundo fator antes da troca obrigatória.
- **`PASSWORD_SAME_AS_CURRENT`** incluído.
- **R11 = A**: 403 `PASSWORD_CHANGE_REQUIRED` nas demais rotas administrativas até a troca.
- **Números**: bloqueio de 15 min após 5 falhas, dobrando a cada série até 24 h; 20/min por IP; 10 a cada 15 min por
  conta; configuráveis por ambiente com esses padrões, validados no schema.

## Project Structure

### Documentation (this feature)

```text
specs/006-staff-sign-in/
├── plan.md
├── research.md           # R1–R13
├── data-model.md
├── quickstart.md
├── contracts/auth-api.md
├── checklists/requirements.md
└── tasks.md              # (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── app.setup.ts                                   # enableCsrfProtection({ trustedOrigins: CORS_ORIGINS })
├── config/env.schema.ts                           # números de bloqueio e limite, AUTH_HMAC_SECRET
├── common/http/route-decorators.ts                # StepRoute(etapas)
├── database/migrations/<ts>-StaffSignIn.ts        # lockout_level, password_change_failures
├── infra/auth/
│   ├── auth-audit.subscriber.ts                   # + mfa-enabled, recovery-code
│   ├── hmac-keys.ts                               # chaves por finalidade (HKDF do AUTH_HMAC_SECRET, R4a)
│   ├── password-change-gate.guard.ts              # R11 (sessão verificada com troca pendente)
│   └── stores/pg-session.store.ts                 # + contador de troca de senha
├── infra/throttle/redis-throttler.storage.ts      # ThrottlerStorage sobre o Redis (R4)
├── modules/auth/
│   ├── auth.controller.ts                         # sign-in, mfa/challenge, sign-out, mfa/enrollment(+confirmation)
│   ├── me-security.controller.ts                  # PUT /me/password, GET/DELETE /me/sessions
│   ├── credentials.service.ts                     # verificação, status, bloqueio progressivo, rehash (R3)
│   ├── next-step.ts                               # cálculo da etapa (R2)
│   ├── password-change.service.ts                 # política, contador, troca (R6, R7)
│   ├── mfa-enrollment.service.ts                  # cadastro, confirmação, recuperação (R8)
│   ├── qr-png.ts                                  # matriz uqr → PNG com node:zlib (R5)
│   ├── own-sessions.service.ts                    # lista e encerramento (R13)
│   ├── auth.schemas.ts                            # entrada e respostas (zod → OpenAPI)
│   └── auth.module.ts                             # (existente) passa a ter controllers e serviços
├── modules/audit/                                 # AUTH_PASSWORD_CHANGE_FAILED + schemas
└── modules/auth/password/password-policy.ts       # + PASSWORD_SAME_AS_CURRENT

test/
├── auth/                                          # e2e das US1 a US5 e do fluxo inteiro
├── openapi/auth-contract.e2e-spec.ts              # contrato do front (R12)
├── infra/redis-throttler.storage.e2e-spec.ts      # storage do limite (R4)
├── users/support.ts                               # passa a usar as rotas definitivas
└── contract/auth/example/                         # fica só a parte de autorização (R1)
```

**Structure Decision**: projeto único; rotas no `auth` (que já tinha entidades e o hasher), regras de sessão e guards
no `infra/auth`, limite de tentativas no `infra/throttle`.

## Complexity Tracking

| Violação                                     | Por que é necessária                                      | Alternativa mais simples rejeitada porque                                        |
| -------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Duas dependências novas (`throttler`, `uqr`) | Limite entre instâncias e QR code PNG sem serviço externo | Escrever o limitador e o codificador de QR à mão: mais código delicado sem ganho |
| `ThrottlerStorage` próprio sobre o Redis     | O throttler oficial só traz storage em memória            | Storage de terceiros: dependência extra para ~30 linhas                          |
