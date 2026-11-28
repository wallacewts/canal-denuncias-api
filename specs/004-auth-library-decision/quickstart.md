# Quickstart: validar a decisão de autenticação e autorização

## Pré-requisitos

- Node 26.13.1 (`.tool-versions`), `npm ci`.
- `docker compose up -d` (Postgres 18, Vault de dev com `app-kek`, Redis).
- `npm run migration:run` (inclui `AuthStores`).

## Cenários

1. **Decisão registrada**: abrir `docs/adr/README.md` e conferir as linhas D53 (autenticação, sem renovação por tokens) e D54
   (autorização), com a tabela requisito × opção de `research.md`.
2. **Contrato dos stores**: `npx vitest run --config vitest.config.e2e.ts test/contract/auth/store-contract` → todos
   os casos de `authenticationStoreContract()` passam contra o Postgres, inclusive os concorrentes.
3. **Login com MFA (US2)**: `…/sign-in-mfa` → só senha dá 401 na rota protegida; senha + TOTP dá 200; o mesmo código
   recusado na segunda vez; e-mail inexistente e senha errada com a mesma resposta e diferença de tempo menor que 10%.
4. **Expirações (US2)**: `…/session-expiry` → com relógio controlado, 401 após 15 min sem uso e após 8 h de uso
   contínuo; sessão válida depois de reiniciar o app; app não sobe em modo produção com store em memória. Encerrar todas as sessões do usuário (saída de
   todos os lugares, troca de senha, desativação) faz nenhuma delas autenticar a requisição seguinte; o id da sessão muda
   no login e no MFA.
5. **Cookie (US2)**: a resposta de login traz `__Host-sid` com `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`; o
   token não aparece no corpo.
6. **Autorização (US3)**: `…/authorization` → rota sem regra dá 403 e aparece no log da inicialização; regra por
   perfil; listagem do Analista só com os atribuídos e sem o bloqueado (e a consulta já filtrada); DPO lê e não trata;
   autoalteração de perfis dá 403; `ACCESS_DENIED` na trilha; sem sessão dá 401.
7. **Encaixe (US4)**: `…/integration` → administrador criado por `npm run cli -- create-admin` entra sem migração de
   hash; rota auditada grava ator equipe com o id da sessão; a área pública não recebe nem lê cookie.
8. **Segredo TOTP selado**: consultar `users.mfa_secret_enc` do usuário de teste e conferir que não contém o segredo
   base32 (é o formato selado do `AppSecretService`).
