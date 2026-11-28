# Quickstart: validar o login da equipe

## Pré-requisitos

- Node 26.13.1 (`.tool-versions`), `npm ci`.
- `docker compose up -d` (Postgres 18, Vault de dev, Redis) e `npm run migration:run` (inclui `StaffSignIn`).

## Cenários (suítes e2e em `test/auth/`)

1. **Entrada com MFA (US1)**: senha certa → `MFA_REQUIRED` com horários; código válido → `DONE`, cookie novo, cookie
   antigo sem valor; código errado ou repetido → 422 `MFA_CODE_INVALID`; 5 errados → 423; código de recuperação vale
   uma vez.
2. **Resposta genérica (US1)**: inexistente, senha errada, `BLOCKED`, `DISABLED` e bloqueio temporário dão a mesma
   resposta 401; diferença de tempo inexistente × senha errada < 10% (20 de cada); motivo só na trilha.
3. **Bloqueio progressivo (US1)**: 5 falhas → 15 min (com `TestClock`); nova série → 30 min; entrada completa zera.
4. **Fluxo inteiro (AUTH-06)**: entrada, desafio, `GET /me` 200, saída, `GET /me` 401, sem o login de exemplo.
5. **Primeiro acesso (US2)**: pessoa criada pelo `POST /users` → `PASSWORD_CHANGE_REQUIRED` → troca →
   `MFA_ENROLLMENT_REQUIRED` → cadastro (PNG decodificável, segredo) → confirmação (10 códigos, `DONE`); antes de
   `DONE`, `GET /me` dá 401.
6. **Com autenticador e troca obrigatória (Q2)**: `MFA_REQUIRED` → desafio → `PASSWORD_CHANGE_REQUIRED` → troca →
   `DONE`; outras rotas no intervalo conforme a R11.
7. **Troca de senha (US3)**: 422 por regra (curta, comum, igual à atual); 4 erros de senha atual → 422; 5º → 429 e
   401 depois; 5 simultâneos → sessão encerrada uma vez; outra sessão da pessoa cai na troca bem-sucedida.
8. **Sessões (US4)**: lista com a atual marcada, sem o valor do cookie; encerrar outra; encerrar todas; de outra
   pessoa → 404.
9. **Origem e limite (US5)**: `POST` administrativo com `Origin` de fora → 403; 21 entradas do mesmo IP em 1 min →
   429 com `Retry-After`; mesma resposta para e-mail existente e inexistente.
10. **Contrato do front**: `test/openapi/auth-contract.e2e-spec.ts` compara rotas, schemas de sucesso, status e
    códigos de erro do `openapi/admin.json` com o `auth-api.md` do front.

## Conferências finais

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, `npm run openapi:export`.
- Compose `--profile app`: `POST /api/admin/v1/auth/sign-in` com credencial errada → 401 genérico; com `Origin`
  estranho → 403.
