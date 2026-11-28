# Quickstart: validar a gestão da equipe e o meu perfil

## Pré-requisitos

- Node 26.13.1 (`.tool-versions`), `npm ci`.
- `docker compose up -d` (Postgres 18, Vault de dev, Redis) e `npm run migration:run`.
- Sessões nos testes: login de exemplo da feature 004 (`test/contract/auth/example/`), só de teste, até o AUTH-01 a
  AUTH-04 existirem.

## Cenários (suítes e2e da feature, `npx vitest run --config vitest.config.e2e.ts test/users/`)

1. **Cadastro (US1)**: Administrador cria uma pessoa → 201 com `temporaryPassword`; detalhe sem a senha; e-mail
   repetido (com outra caixa) → 409 `EMAIL_ALREADY_REGISTERED`; `USER_CREATED` só com os perfis; a senha (inclusive
   trecho curto) não aparece nos logs nem na trilha, nem quando o cadastro falha.
2. **Listagem (US1)**: 30 pessoas, filtro por status e perfil, páginas de 10 por cursor; nenhum hash ou segredo na
   resposta; Analista → 403 com `ACCESS_DENIED`.
3. **Meu perfil (US2)**: para cada perfil, `abilities` igual à matriz (contracts/me-api.md); perfil retirado reflete
   na requisição seguinte; com relógio controlado, `idleExpiresAt` = último uso + 15 min (nunca depois) e
   `absoluteExpiresAt` = início + 8 h; nenhum registro novo na trilha; sem sessão → 401.
4. **Concordância catálogo × servidor (US2)**: para cada perfil, `users.manage` no `/me` ⇔ 200 nas rotas de equipe;
   `audit.read` ⇔ 200 na trilha. O teste de documento falha se a matriz do ACL-01 mudar sem o catálogo.
5. **Status (US3)**: bloquear e desativar derrubam a sessão da pessoa na requisição seguinte (401); reativar não
   ressuscita sessão antiga; mudar o próprio status → 403; Analista com denúncia aberta atribuída → desativar dá 409
   com `details.assignedReports`, bloquear funciona.
6. **Perfis (US3)**: trocar os próprios perfis → 403; Administrador acumula perfil que lê denúncias concedido por outro
   → 200; duas retiradas simultâneas entre os dois últimos Administradores → só uma passa (a outra 403 ou 409) e sempre
   sobra um; Administrador bloqueado no meio da requisição não aplica a mudança (403); o 409 `LAST_ACTIVE_ADMIN` isolado
   é provado no teste de integração do serviço.
7. **Reset do MFA (US4)**: autenticador e códigos somem, sessão da pessoa cai, `USER_MFA_RESET` registrado; reset do
   próprio MFA → 403; reset de quem não tem MFA → 204 e registro.
8. **Último login**: após entrar com senha e MFA, `lastLoginAt` da pessoa é preenchido.

## Conferências finais

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`.
- `npm run openapi:export` e commit de `openapi/admin.json` (rotas novas).
- Comparar `openapi/admin.json` (`/me`) com o `CurrentUser` do contrato do front: mesmos campos e tipos.
