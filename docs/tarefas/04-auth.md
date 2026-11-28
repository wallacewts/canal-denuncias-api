# 04 · auth

**Objetivo:** login da equipe interna com senha e MFA obrigatório por TOTP, sessão com expiração por inatividade
(15 min) e absoluta (8 h), códigos de recuperação e bloqueio progressivo.

**Depende de:** USERS-01, CRYPTO-05 (segredo TOTP), AUDIT-02.

> **Feito na feature 006 (D57):** AUTH-01 a AUTH-08, em `src/modules/auth/` e `src/infra/throttle/`; contrato em
> `specs/006-staff-sign-in/contracts/auth-api.md`.

> **Já existe (feature 004, D53):** `@nestjs/authentication` configurado, stores Postgres de sessão e MFA, guard
> global, `OpenAdminRoute()` para as rotas de login, ponte com a `AUTH_IDENTITY` e eventos de autenticação gravados
> na trilha. As tarefas abaixo constroem as rotas reais e as regras do produto em cima disso. O que existe, o fluxo
> que o backoffice vai usar e o que cada tarefa constrói estão em
> `docs/adr/0053-autenticacao-e-autorizacao.md` ("O que já existe e o que cada tarefa seguinte constrói"). As rotas
> de `test/contract/auth/example/` são só referência de implementação.

---

### AUTH-00 · Decisão: bibliotecas próprias ou pacote oficial do Nest 12

> Parcialmente decidido na feature 001 (D32): o hash de senha usa o `PasswordHasher` (scrypt) do
> `@nestjs/authentication` 0.1.8. Falta decidir o restante (sessão, MFA, guard) e o store em Postgres.

**Estimativa:** M · **Marco:** MVP

O registro de decisões previa `passport`, `passport-jwt`, `argon2` e `otplib`. O Nest 12 tem o pacote oficial
`@nestjs/authentication`, que já traz guard global (tudo fechado por padrão, `@Public()` para abrir),
`@CurrentUser()`, `PasswordHasher` com comparação de tempo constante (inclusive para e-mail inexistente), sessão por
cookie (`SessionCookieProvider`, cookie `__Host-sid`), tokens com refresh rotativo e detecção de reuso, TOTP, eventos
para auditoria (`AuthenticationEvents.events$`) e proteção CSRF.

Pontos a avaliar:

- **Hash de senha:** o pacote usa scrypt. A decisão D03 fala em argon2id. Os dois são aceitos pelo OWASP. Usar o
  pacote significa trocar a decisão ou plugar argon2 por conta própria.
- **Armazenamento:** o pacote guarda sessões, refresh tokens e estado de MFA em memória até registrar um store
  (`AuthenticationStorage.registerSource()`), e se recusa a subir em produção sem store. Precisa de um store sobre o
  Postgres, usando ou adaptando as tabelas `sessions` e `recovery_codes`.
- **Timeouts:** confirmar que dá para ter expiração por inatividade de 15 min e absoluta de 8 h.
- **Maturidade:** o pacote está na versão 0.1.x.

Ler antes: `.claude/skills/nestjs-auth/` e https://docs.nestjs.com/security/authentication.md.

- **Arquivos:** ADR novo em `docs/adr/`. Se mudar o modelo, migration ajustando `sessions` e `recovery_codes`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] ADR com a escolha, os motivos e o impacto em D03 (hash) e no modelo de dados (D53,
      `docs/adr/0053-autenticacao-e-autorizacao.md`).
- [x] Protótipo mínimo (login, MFA e rota protegida) com a opção escolhida, rodando contra o Postgres
      (`test/contract/auth/`, feature 004).

### AUTH-01 · Login com senha

**Estimativa:** M · **Marco:** MVP · **Depende de:** AUTH-00

- **Arquivos:** `src/modules/auth/auth.controller.ts`, `credentials.service.ts`.
- **Endpoints:** `POST /api/admin/v1/auth/sign-in` (público, responde 200).
- **Auditoria:** `AUTH_SIGNED_IN` (já gravado pelo assinante a partir do evento do pacote, D53) e
  `AUTH_LOGIN_FAILED`, gravado pelo serviço de credenciais (o pacote não emite evento de senha errada; metadata:
  motivo codificado, ex. `bad_credentials`, `locked`, `disabled`).

**Critérios de aceite**

- [x] E-mail inexistente e senha errada levam o mesmo tempo e recebem a mesma resposta (401 genérico).
- [x] Usuário `BLOCKED` ou `DISABLED` recebe a mesma resposta genérica. O motivo real fica só na auditoria.
- [x] Bloqueio progressivo: depois de 5 falhas seguidas, `locked_until` de 15 min, dobrando a cada nova série até 24 h.
      Login com sucesso zera `failed_login_count`. Números configuráveis por ambiente com esses padrões, validados no
      schema (feature 006).
- [x] Com sessão verificada e troca obrigatória pendente (quem tem autenticador passa primeiro pelo desafio), as demais
      rotas administrativas respondem 403 `PASSWORD_CHANGE_REQUIRED`; liberadas só `PUT /me/password`, `sign-out` e
      `GET /me` (com `passwordChangeRequired: true`). Decidido pelo usuário em 28/11/2026 (feature 006, R11).
- [x] Rota de etapa (troca de senha, cadastro do MFA) chamada fora da etapa responde 403 `STEP_NOT_ALLOWED`; 401
      continua só para sessão ausente ou expirada. Decidido pelo usuário em 28/11/2026 (feature 006, I1).
- [x] O login cria uma sessão em estado "MFA pendente", que só acessa as rotas de MFA e de troca de senha (o
      pacote já cria a sessão pendente com `SignInService.signIn`; `@AdminApi` já exige MFA verificado).
- [x] Hash antigo é refeito com o custo atual quando necessário.
- [x] Testes: sucesso, senha errada, e-mail inexistente, bloqueio e desbloqueio.

**Premissas de contrato do login (propostas do front, feature 004 do backoffice; valem para AUTH-01 a AUTH-04)**

- [x] A resposta de sucesso do login e do desafio MFA informa a próxima etapa em código: `MFA_REQUIRED`,
      `MFA_ENROLLMENT_REQUIRED`, `PASSWORD_CHANGE_REQUIRED` ou `DONE`. Falha de credencial continua 401 genérico, sem
      etapa.
- [x] As respostas do login e do desafio trazem os horários de expiração da sessão (inatividade e absoluta, ISO 8601
      UTC), como o `GET /me` (USERS-07).
- [x] Bloqueio do desafio MFA (5 falhas em 15 min, depois que a senha já foi provada) responde **423**, distinto do
      código inválido. Excesso de tentativas pelo rate limit é 429 com `Retry-After` (AUTH-08). (Propostas do
      front.)
- [x] Código do autenticador errado ou já usado responde **422 `MFA_CODE_INVALID`**, no desafio e na confirmação do
      cadastro, mantendo a sessão pendente. Em todo o fluxo de login, 401 significa só sessão ausente ou expirada.
      Decidido pelo usuário em 28/11/2026 (feature 006, Q1).
- [x] Ordem das etapas: sem autenticador, troca de senha (se obrigatória) e depois cadastro do MFA; com autenticador,
      desafio MFA e depois troca de senha (se obrigatória). Ninguém troca a senha tendo provado só a senha antiga
      quando já tem autenticador. Decidido pelo usuário em 28/11/2026 (feature 006, Q2).
- [x] O bloqueio progressivo da etapa de senha recebe a **mesma resposta genérica** da credencial inválida, sem código
      próprio: uma resposta distinta revelaria que o e-mail existe (FR-006 da feature 004). Decidido pelo usuário em
      28/11/2026.

### AUTH-02 · Sessão, expiração e logout

**Estimativa:** M · **Marco:** MVP · **Depende de:** AUTH-00

- **Entidades:** `Session` (ou o store definido em AUTH-00).
- **Endpoints:** `POST /api/admin/v1/auth/sign-out` (204), `GET /api/admin/v1/me/sessions`,
  `DELETE /api/admin/v1/me/sessions/:id`.
- **Auditoria:** `AUTH_SIGNED_OUT`, `AUTH_SESSION_REVOKED` (nomes fixados na feature 004, D53).

**Critérios de aceite**

- [x] Cookie `HttpOnly`, `Secure`, `SameSite=Strict`. Nada em `localStorage`.
- [x] Expira com 15 min sem uso e com 8 h de duração total, o que vier primeiro.
- [x] A sessão é renovada (novo id) depois do MFA e depois da troca de senha.
- [x] Não há refresh token (D53, Q-P2 da feature 004): a sessão por cookie é o único meio de autenticação; sair de
      todos os lugares encerra todas as sessões do usuário e grava `AUTH_SESSION_REVOKED`.
- [x] A lista de sessões mostra criação, último uso, IP e user-agent, e marca a sessão atual.
- [x] Os horários de expiração (inatividade e absoluta) saem do registro da sessão (`last_active_at` + 15 min,
      `expires_at`) e vão no `GET /me` e nas respostas do login e do desafio (proposta do front). O último uso é
      gravado no máximo uma vez por minuto (`touchInterval`), então o horário de inatividade informado pode vir até
      1 min antes do real (nunca depois).

### AUTH-03 · Cadastro do MFA (primeiro acesso)

**Estimativa:** M · **Marco:** MVP · **Depende de:** AUTH-01, CRYPTO-05

- **Entidades:** `User.mfaSecretEnc`, `User.mfaEnabledAt`, `RecoveryCode`.
- **Endpoints:** `POST /api/admin/v1/auth/mfa/enrollment` (gera o segredo) e
  `POST /api/admin/v1/auth/mfa/enrollment/confirmation` (confirma com um código).
- **Auditoria:** `AUTH_MFA_ENROLLED`.

**Critérios de aceite**

- [x] A geração devolve a URI `otpauth://`, o QR code como PNG embutido (`data:image/png;base64,...`, nunca SVG, gerado
      na API, sem serviço externo) e o segredo em texto para digitação manual, com o nome do sistema como emissor. O
      segredo vai cifrado com a `app-kek` (o `PgMfaStore` já faz) e nunca vai para log ou auditoria. (Proposta do
      front.)
- [x] Só ativa depois de confirmar um código válido; código errado responde 422 `MFA_CODE_INVALID` e o cadastro
      continua pendente (feature 006, Q1).
- [x] Na confirmação, gera 10 códigos de recuperação, devolvidos na resposta da confirmação uma única vez e guardados
      como hash. (Proposta do front.)
- [x] Usuário sem MFA não acessa nenhuma rota além das de cadastro do MFA, troca de senha e saída (401: a sessão não
      está verificada, como o `GET /me` no contrato do front).

### AUTH-04 · Desafio MFA no login

**Estimativa:** M · **Marco:** MVP · **Depende de:** AUTH-03

- **Endpoints:** `POST /api/admin/v1/auth/mfa/challenge` (código TOTP ou código de recuperação).
- **Auditoria:** `AUTH_MFA_FAILED`, `AUTH_RECOVERY_CODE_USED`.

**Critérios de aceite**

- [x] Aceita o passo atual e um passo de tolerância de relógio (±30 s); código errado ou já usado responde 422
      `MFA_CODE_INVALID` (feature 006, Q1).
- [x] O mesmo código não é aceito duas vezes (já garantido pelo pacote com `users.mfa_last_used_step`, feature 004;
      falta o teste na rota real).
- [x] Código de recuperação é de uso único (o store apaga o código ao consumir, feature 004; falta o teste na rota
      real).
- [x] Falhas de MFA contam para o bloqueio progressivo do login (o pacote já bloqueia o MFA com 5 falhas em 15 min,
      tabela `mfa_failures`).

### AUTH-05 · Senha: política e troca

**Estimativa:** P · **Marco:** MVP · **Depende de:** AUTH-01

- **Endpoints:** `PUT /api/admin/v1/me/password` (senha atual e nova).
- **Auditoria:** `AUTH_PASSWORD_CHANGED`, `AUTH_PASSWORD_CHANGE_FAILED`.

**Critérios de aceite**

- [x] Política: mínimo de 12 caracteres e recusa de senhas comuns (lista local, sem consulta externa).
- [x] Troca obrigatória quando `password_changed_at` é nulo.
- [x] Trocar a senha revoga as outras sessões do usuário.
- [x] Nova senha que viola a política responde 422 com o código da regra violada (`PASSWORD_TOO_SHORT`,
      `PASSWORD_COMMON` ou `PASSWORD_SAME_AS_CURRENT`, este decidido na feature 006), sem ecoar a senha na resposta, no
      log ou na auditoria. (Proposta do front.)
- [x] Senha atual errada responde 422 com o código `CURRENT_PASSWORD_INVALID`, no mesmo formato dos outros erros da
      troca de senha, sem ecoar a senha na resposta, no log ou na auditoria. 401 continua significando só sessão
      ausente ou expirada. (Proposta do front, decidida pelo usuário em 28/11/2026.)
- [x] Limite de senha atual errada: os erros 1 a 4 na mesma sessão respondem 422 (`CURRENT_PASSWORD_INVALID`); o 5º
      responde 429 e encerra a sessão (o cookie é apagado e a requisição seguinte dá 401; o usuário entra de novo).
      Erro de política da senha nova não conta. O contador fica com a sessão, no Postgres, e sobe com um UPDATE
      condicional (duas requisições simultâneas não passam do limite). O pacote não tem troca de senha, evento nem
      contador para isso (só o bloqueio do MFA e a redefinição por e-mail), então é código da aplicação; o
      encerramento usa o `SignInService.signOut`, que já grava `AUTH_SIGNED_OUT` pelo assinante. Decidido pelo
      usuário em 28/11/2026.
- [x] Cada erro grava `AUTH_PASSWORD_CHANGE_FAILED` (ação nova no `AuditAction` e no mapa de schemas), com metadata
      só `{ reason: 'CURRENT_PASSWORD_INVALID', attempt: 1..5, locked: boolean }`, nunca a senha.
- [x] Teste e2e: 4 erros dão 422 e 4 registros (`attempt` 1 a 4, `locked: false`); o 5º dá 429, a sessão some do
      banco, o mesmo cookie dá 401 e o registro tem `locked: true`; 5 requisições simultâneas erradas encerram a sessão
      uma única vez; a senha enviada (inclusive um texto curto como `XQZ`) não aparece na resposta, nos logs nem na
      trilha; uma sessão nova começa o contador do zero.

### AUTH-06 · Guard global e usuário atual

**Estimativa:** M · **Marco:** MVP · **Depende de:** AUTH-02

**Critérios de aceite**

- [x] Toda rota exige autenticação por padrão. Rotas públicas (denunciante, login, health) são abertas
      explicitamente (feature 004: guard global do pacote, `@PublicApi`, `OpenAdminRoute()`, `@Public()` no health).
- [x] O usuário e os perfis são lidos do banco a cada requisição. Usuário bloqueado ou desativado perde o acesso na
      hora (feature 004: `PgSessionStore.getSession` + `StaffSessionProvider`).
- [x] O usuário atual fica disponível nos serviços (contexto assíncrono) para a auditoria (AUDIT-03) e a autorização
      (feature 004: `SessionAuthIdentity` → `AuditContext`; `@CurrentUser()` e `request.user` para as políticas).
- [x] Teste e2e com o fluxo inteiro: login, MFA, rota protegida, logout e rota protegida de novo (401).

### AUTH-07 · CSRF e CORS

**Estimativa:** P · **Marco:** MVP · **Depende de:** AUTH-02

**Critérios de aceite**

- [x] Proteção CSRF nas rotas administrativas que alteram dados (`app.enableCsrfProtection` do Nest 12, com as
      origens confiáveis do backoffice). O cookie já é `SameSite=Strict` (feature 004).
- [x] CORS com credenciais só para a origem do backoffice. O portal público não recebe credenciais.
- [x] Teste: `POST` administrativo vindo de outra origem é recusado.

### AUTH-08 · Rate limit nas rotas de login

**Estimativa:** P · **Marco:** Produção · **Depende de:** AUTH-01, TRV-05

Proteção contra tentativa de adivinhar senha da equipe (não confundir com spam de denúncias, que está fora do escopo).

**Critérios de aceite**

- [x] `@nestjs/throttler` com storage no Redis em `sign-in` e `mfa/challenge`, por IP (20/min) e por conta (10 a cada
      15 min; chave sem o e-mail em claro), números configuráveis por ambiente com esses padrões (feature 006).
- [x] Resposta 429 com `Retry-After`.
