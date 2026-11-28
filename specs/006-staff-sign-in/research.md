# Research: Login da equipe, MFA, senha e sessões

Decisões técnicas da feature 006, conferidas nos pacotes instalados (`@nestjs/authentication` 0.1.8,
`@nestjs/authorization` 0.1.4, `@nestjs/common`/`core` 12) e no npm em 2026-11-28. Um ponto depende do usuário (R11).

## R1. O que do login de exemplo da feature 004 vira código definitivo

**Decision**: promovidos para `src/modules/auth/`:

| Exemplo em `test/contract/auth/example/`             | Definitivo                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| `ExampleCredentials.verify` (hash sempre verificado) | `CredentialsService` (+ status, bloqueio progressivo, rehash, R3) |
| `ExampleAuthController.enter` (`sign-in`)            | `AuthController` `POST /auth/sign-in` com `nextStep` e horários   |
| `ExampleAuthController.mfa`                          | `POST /auth/mfa/challenge` (`code` ou `recoveryCode`, 422/423)    |
| `ExampleAuthController.signOut`                      | `POST /auth/sign-out` (aberta também à sessão pendente)           |
| `ExampleAuthController.everywhere`                   | `DELETE /me/sessions` (encerra todas)                             |
| `ExampleAuthController.me`                           | já substituído pelo `GET /me` da feature 005                      |

Ficam **só de teste** a `ExamplePolicy`, a `ExampleAdminController` e a função de escopo de exemplo (provas de
autorização da 004). O apoio de teste (`test/users/support.ts` e os e2e da 004 e 005) passa a entrar pelas rotas
definitivas; `ExampleCredentials` e as rotas `example-auth` são removidas.

**Rationale**: o comportamento já foi provado com os stores definitivos; manter dois caminhos de login seria
superfície duplicada.

## R2. Etapas, estados de sessão e rotas por etapa

O guard do pacote nunca autentica uma sessão `mfa: 'pending'` (401) e `@AdminApi` exige `mfa: 'verified'`. A sessão
de quem não tem autenticador nasce sem `mfa` (o `signIn` só marca `pending` quando há autenticador).

**Decision**: a próxima etapa é calculada a cada resposta (`nextStepFor(user, session)`):

1. sessão `pending` → `MFA_REQUIRED`;
2. sessão verificada e troca obrigatória → `PASSWORD_CHANGE_REQUIRED` (Q2: segundo fator antes da troca);
3. sessão sem MFA e troca obrigatória → `PASSWORD_CHANGE_REQUIRED`;
4. sessão sem MFA e sem troca → `MFA_ENROLLMENT_REQUIRED`;
5. sessão verificada sem troca → `DONE`.

Rotas por etapa:

- `sign-in`, `mfa/challenge`, `sign-out`: `OpenAdminRoute()` (o `SignInService` lê o próprio cookie).
- `PUT /me/password`, `POST /auth/mfa/enrollment` e `/confirmation`: decorador novo `StepRoute(etapas)` =
  `Authenticate({ mfa: false })` + `@Can.Anyone()` + metadado com as etapas aceitas; o serviço confere a etapa
  atual; fora dela, 403 `STEP_NOT_ALLOWED` (decisão do usuário, I1): o 401 continua só para sessão ausente ou
  expirada.
- Demais rotas administrativas: continuam com `@AdminApi` (MFA verificado); a troca obrigatória com sessão
  verificada é tratada pela R11.

**Rationale**: usa só os mecanismos do pacote; a etapa nunca é guardada, então não diverge do estado real.

## R3. Bloqueio progressivo sem revelar a existência do e-mail

**Decision**:

- `CredentialsService.verify(email, senha)` sempre roda `PasswordHasher.verify` (com o hash fictício do pacote quando
  o e-mail não existe), **antes** de olhar status ou bloqueio: o tempo é o mesmo em todos os casos.
- Depois da verificação: e-mail inexistente, senha errada, `BLOCKED`, `DISABLED` ou `locked_until` no futuro → 401
  genérico idêntico; `AUTH_LOGIN_FAILED` com `reason` (`UNKNOWN_ACCOUNT`, `BAD_CREDENTIALS`, `TEMPORARILY_LOCKED`,
  `BLOCKED`, `DISABLED`), sem e-mail.
- Senha errada de conta existente e não bloqueada: `UPDATE users SET failed_login_count = failed_login_count + 1 …
RETURNING` (atômico); ao chegar a 5, `locked_until = now + 15 min × 2^lockout_level`, `lockout_level + 1` e o
  contador volta a 0, na mesma instrução. Teto de 24 h. Tentativas durante o bloqueio não contam.
- Números configuráveis por ambiente, validados no schema de ambiente, com os padrões aprovados pelo usuário:
  `LOGIN_LOCKOUT_THRESHOLD` (5), `LOGIN_LOCKOUT_BASE_MINUTES` (15) e `LOGIN_LOCKOUT_MAX_MINUTES` (1440).
- Código errado no desafio soma no mesmo contador (FR-003), pelo mesmo `UPDATE`.
- Entrada completa (`mfa-verified`, ou senha de quem não tem MFA) zera `failed_login_count` e `lockout_level`.
- Rehash: com a senha correta e `needsRehash(hash)`, grava o hash novo (FR-004).

**Rationale**: a mesma resposta e o mesmo tempo para todos os casos (decisão do usuário, FR-006 da 004); o contador
atômico não deixa requisições paralelas passarem do limite.

O volume de `AUTH_LOGIN_FAILED` (inclusive de e-mails inexistentes) fica limitado pelo limite de tentativas da R4
(N1).

**Alternatives considered**: contar também e-mails inexistentes numa tabela própria (revelaria nada a mais, mas
cresceria com qualquer e-mail digitado; o rate limit por conta da R4 já cobre a adivinhação).

## R4. Limite de tentativas (AUTH-08)

**Decision**: `@nestjs/throttler` **6.7.1** (versão exata; a 6.8.0 tem 12 dias, abaixo da carência de duas semanas
adotada para dependências novas; ambas aceitam Nest 12) com um `ThrottlerStorage` próprio sobre o Redis que a API já
usa (`src/infra/queue/redis.connection.ts`, `INCR` + `PEXPIRE` em script atômico). Guard só nas rotas `sign-in` e
`mfa/challenge`, com dois limites: por IP (20 por minuto) e por conta (10 por 15 min; chave = HMAC-SHA-256 do e-mail
normalizado com a chave de finalidade `throttle-account`, derivada por HKDF do `AUTH_HMAC_SECRET`, nunca o e-mail no
Redis; no desafio, o id da pessoa da sessão pendente).
Estourou: 429 com `Retry-After`. O limite por conta vale igual para e-mail existente e inexistente. Números
configuráveis por ambiente, validados no schema, com os padrões aprovados: `AUTH_RATE_LIMIT_IP_LIMIT` (20),
`AUTH_RATE_LIMIT_IP_WINDOW_SECONDS` (60), `AUTH_RATE_LIMIT_ACCOUNT_LIMIT` (10) e
`AUTH_RATE_LIMIT_ACCOUNT_WINDOW_SECONDS` (900).

**Rationale**: vale para todas as instâncias; não guarda e-mail em claro; não revela existência.

**Alternatives considered**: storage Redis de terceiros (`@nest-lab/throttler-storage-redis`): dependência extra
para ~30 linhas; storage em memória: não vale entre instâncias.

## R4a. Segredo do HMAC

**Decision**: variável nova `AUTH_HMAC_SECRET` (obrigatória fora de desenvolvimento e teste, mínimo de 32 bytes,
nunca no repositório; padrão só em desenvolvimento). Uma chave por finalidade, derivada com `hkdfSync('sha256',
segredo, '', finalidade, 32)` do `node:crypto`: `throttle-account` (chave de conta do limite de tentativas) e
`session-public-id` (id público de sessão). Trocar o segredo só invalida contadores do limite e ids públicos
listados, nada guardado (U1).

## R5. QR code PNG sem dependência pesada

**Decision**: `uqr` **0.1.3** (MIT, sem dependências, ESM, publicado em 2026-04-03) só para gerar a matriz do QR code;
o PNG é montado pela API com `node:zlib` (`deflateSync` e `crc32`, nativos no Node 26): escala inteira, margem de 4
módulos, PNG em tons de cinza de 1 bit. Resultado: `data:image/png;base64,…`. Teste: decodificar o PNG gerado e
conferir assinatura, dimensões e que a matriz lida bate com a do `uqr`.

**Rationale**: o front só aceita PNG embutido (o sanitizador recusa SVG); nada de serviço externo.

**Alternatives considered**: `qrcode` 1.5.4 (traz `yargs`, `pngjs` e `dijkstrajs`: CLI e dependências que a API não
usa); `qrcode-generator` 2.0.4 (sem dependências, mas só gera GIF/SVG e é CommonJS); escrever o codificador de QR
(Reed-Solomon, máscaras): código delicado sem ganho.

## R6. Contador de 5 erros na troca de senha

**Decision**: coluna nova `sessions.password_change_failures smallint NOT NULL DEFAULT 0` (CHECK 0..5). A troca
verifica a senha atual (sempre com o hash, mesmo tempo); errada → `UPDATE sessions SET password_change_failures =
password_change_failures + 1 WHERE id = $1 AND password_change_failures < 5 RETURNING password_change_failures`. De 1
a 4: 422 `CURRENT_PASSWORD_INVALID`; ao chegar a 5: `SignInService.signOut()` (cookie apagado, `AUTH_SIGNED_OUT`
pelo assinante) e 429. Requisição que não consegue incrementar (já em 5) também recebe 429. Cada erro grava
`AUTH_PASSWORD_CHANGE_FAILED { reason, attempt, locked }`. Sessão nova começa em 0 (coluna da sessão). Erro de
política não passa pelo contador.

**Rationale**: o `UPDATE` condicional é atômico; 5 requisições simultâneas incrementam até 5 e só a que chega a 5
encerra a sessão.

## R7. Troca de senha bem-sucedida

**Decision**: política (`checkPasswordPolicy`) + diferente da atual (`PASSWORD_SAME_AS_CURRENT`, conferido com o hash
atual); hash novo antes da transação; na transação: `password_hash`, `password_changed_at = now`, contador zerado,
`AUTH_PASSWORD_CHANGED`; depois: `SessionService.revokeAll(userId, { except: atual })` e `SessionService.rotate`
(id novo, cookie novo). Resposta: `StepResponse` com a etapa seguinte.

## R8. Cadastro do autenticador e recuperação

**Decision**: `MfaService.enroll(userId, email)` gera o segredo pendente (selado pelo `PgMfaStore`) e a URI; a API
monta o PNG (R5). Confirmação: `SignInService.confirmMfa(userId, code)` (ativa e roda a sessão para `verified` com id
novo) e `MfaService.generateRecoveryCodes(userId)` (10, hash no store) devolvidos uma vez. Código errado: 422
`MFA_CODE_INVALID`. Eventos: `mfa-enabled` → `AUTH_MFA_ENROLLED`; `mfa-verified` com `recovery-code` →
`AUTH_RECOVERY_CODE_USED` (além do `AUTH_SIGNED_IN`), no `AuthAuditSubscriber`.

## R9. Desafio: 422 e 423

**Decision**: `SignInService.completeMfa({ code } | { recoveryCode })`. Sem sessão pendente: 401. `null` com sessão
pendente: conta as falhas recentes (`PgMfaStore.countMfaFailures(userId, 15 min, agora)`); ≥ 5 → 423 `MFA_LOCKED`,
senão 422 `MFA_CODE_INVALID`. Código de recuperação normalizado (maiúsculas, sem espaços) antes de conferir.

## R10. Proteção por origem (AUTH-07)

**Decision**: `app.enableCsrfProtection({ trustedOrigins: CORS_ORIGINS })` no `setupApp`, antes do `listen`, para
todas as rotas. O Nest 12 decide pelo `Sec-Fetch-Site` e, sem ele, compara `Origin` com `Host`: escrita de outra
origem → 403. O CORS continua com credenciais só para `CORS_ORIGINS` (o backoffice); o portal público é same-origin e
não recebe credenciais.

Do lado do front: o proxy que serve `/api` na mesma origem precisa repassar o `Host` original
(`proxy_set_header Host $host`, já presente em `docs/deploy/nginx/canal-denuncias.conf`) e, no proxy de
desenvolvimento, não reescrever a origem (`changeOrigin: false`); senão, navegadores sem `Sec-Fetch-Site` teriam a
escrita recusada. Registrado como premissa para o front.

## R11. Rotas com sessão verificada e troca obrigatória pendente

Com a Q2, quem tem autenticador e precisa trocar a senha passa pelo desafio (sessão verificada) e só depois troca.
Nesse intervalo, as demais rotas administrativas precisam ser recusadas.

**Decision** (usuário, R11 = A, 2026-11-28): guard global da área administrativa (depois do guard de identidade)
recusa com **403 `PASSWORD_CHANGE_REQUIRED`** (D56) toda rota exceto `PUT /me/password`, `POST /auth/sign-out` e
`GET /me` (que devolve `passwordChangeRequired: true`). O 401 continua só para sessão ausente ou expirada (Q1).

**Alternatives considered**: 401 como a sessão incompleta (voltaria a deixar o 401 ambíguo).

## R12. Teste automático contra o contrato do front

**Decision**: `test/openapi/auth-contract.e2e-spec.ts`, no mesmo molde do teste do `/me` (feature 005): lê
`openapi/admin.json` e o `auth-api.md` do front (só leitura; pulado sem o repositório ao lado):

- toda rota da tabela do front existe no OpenAPI com o mesmo método e caminho;
- o schema 200 de cada rota tem exatamente as chaves e tipos do front (`StepResponse`, cadastro, confirmação);
- os status e códigos de erro que o front lista em cada rota existem no OpenAPI da rota;
- os status a mais da API ficam numa lista explícita do teste (400 de validação, 403 de origem, 403
  `PASSWORD_CHANGE_REQUIRED`, 403 `STEP_NOT_ALLOWED` e 429 no desafio); qualquer outro status a mais falha (C1);
- os códigos de erro citados pelo front (`CURRENT_PASSWORD_INVALID`, `PASSWORD_TOO_SHORT`, `PASSWORD_COMMON`,
  `MFA_CODE_INVALID`) aparecem no OpenAPI da rota.

As respostas de sucesso vêm de schemas zod (fonte do tipo e do OpenAPI) e os e2e validam as respostas reais contra
eles. O `PASSWORD_SAME_AS_CURRENT` é extra (aditivo) e não falha o teste.

## R13. Sessões da própria pessoa

**Decision**: `GET /me/sessions` lista pelo `PgSessionStore.listUserSessions` (só vivas, `SessionService.list`), com
um id público por sessão (HMAC do id da sessão com a chave de finalidade `session-public-id`, derivada por HKDF do
`AUTH_HMAC_SECRET`, nunca o id que está no cookie), criação, último uso, IP, navegador e `current`. `DELETE
/me/sessions/:id` resolve o id público entre as sessões da própria pessoa (de outra: 404) e usa `SessionService.revoke`;
`DELETE /me/sessions` encerra todas (`SignInService.signOutEverywhere`, que grava `AUTH_SESSION_REVOKED`).
