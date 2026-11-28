# 04 · auth

**Objetivo:** login da equipe interna com senha e MFA obrigatório por TOTP, sessão com expiração por inatividade
(15 min) e absoluta (8 h), códigos de recuperação e bloqueio progressivo.

**Depende de:** USERS-01, CRYPTO-05 (segredo TOTP), AUDIT-02.

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

- [ ] E-mail inexistente e senha errada levam o mesmo tempo e recebem a mesma resposta (401 genérico).
- [ ] Usuário `BLOCKED` ou `DISABLED` recebe a mesma resposta genérica. O motivo real fica só na auditoria.
- [ ] Bloqueio progressivo: depois de 5 falhas seguidas, `locked_until` de 15 min, dobrando a cada nova série. Login
      com sucesso zera `failed_login_count`.
- [ ] O login cria uma sessão em estado "MFA pendente", que só acessa as rotas de MFA e de troca de senha (o
      pacote já cria a sessão pendente com `SignInService.signIn`; `@AdminApi` já exige MFA verificado).
- [ ] Hash antigo é refeito com o custo atual quando necessário.
- [ ] Testes: sucesso, senha errada, e-mail inexistente, bloqueio e desbloqueio.

### AUTH-02 · Sessão, expiração e logout

**Estimativa:** M · **Marco:** MVP · **Depende de:** AUTH-00

- **Entidades:** `Session` (ou o store definido em AUTH-00).
- **Endpoints:** `POST /api/admin/v1/auth/sign-out` (204), `GET /api/admin/v1/me/sessions`,
  `DELETE /api/admin/v1/me/sessions/:id`.
- **Auditoria:** `AUTH_SIGNED_OUT`, `AUTH_SESSION_REVOKED` (nomes fixados na feature 004, D53).

**Critérios de aceite**

- [ ] Cookie `HttpOnly`, `Secure`, `SameSite=Strict`. Nada em `localStorage`.
- [ ] Expira com 15 min sem uso e com 8 h de duração total, o que vier primeiro.
- [ ] A sessão é renovada (novo id) depois do MFA e depois da troca de senha.
- [ ] Não há refresh token (D53, Q-P2 da feature 004): a sessão por cookie é o único meio de autenticação; sair de
      todos os lugares encerra todas as sessões do usuário e grava `AUTH_SESSION_REVOKED`.
- [ ] A lista de sessões mostra criação, último uso, IP e user-agent, e marca a sessão atual.

### AUTH-03 · Cadastro do MFA (primeiro acesso)

**Estimativa:** M · **Marco:** MVP · **Depende de:** AUTH-01, CRYPTO-05

- **Entidades:** `User.mfaSecretEnc`, `User.mfaEnabledAt`, `RecoveryCode`.
- **Endpoints:** `POST /api/admin/v1/auth/mfa/enrollment` (gera o segredo) e
  `POST /api/admin/v1/auth/mfa/enrollment/confirmation` (confirma com um código).
- **Auditoria:** `AUTH_MFA_ENROLLED`.

**Critérios de aceite**

- [ ] A geração devolve a URI `otpauth://` e o QR code (data URL) com o nome do sistema como emissor. O segredo vai
      cifrado com a `app-kek`.
- [ ] Só ativa depois de confirmar um código válido.
- [ ] Na confirmação, gera 10 códigos de recuperação, exibidos uma única vez e guardados como hash.
- [ ] Usuário sem MFA não acessa nenhuma rota além das de cadastro do MFA e troca de senha (403).

### AUTH-04 · Desafio MFA no login

**Estimativa:** M · **Marco:** MVP · **Depende de:** AUTH-03

- **Endpoints:** `POST /api/admin/v1/auth/mfa/challenge` (código TOTP ou código de recuperação).
- **Auditoria:** `AUTH_MFA_FAILED`, `AUTH_RECOVERY_CODE_USED`.

**Critérios de aceite**

- [ ] Aceita o passo atual e um passo de tolerância de relógio (±30 s).
- [ ] O mesmo código não é aceito duas vezes (já garantido pelo pacote com `users.mfa_last_used_step`, feature 004;
      falta o teste na rota real).
- [ ] Código de recuperação é de uso único (o store apaga o código ao consumir, feature 004; falta o teste na rota
      real).
- [ ] Falhas de MFA contam para o bloqueio progressivo do login (o pacote já bloqueia o MFA com 5 falhas em 15 min,
      tabela `mfa_failures`).

### AUTH-05 · Senha: política e troca

**Estimativa:** P · **Marco:** MVP · **Depende de:** AUTH-01

- **Endpoints:** `PUT /api/admin/v1/me/password` (senha atual e nova).
- **Auditoria:** `AUTH_PASSWORD_CHANGED`.

**Critérios de aceite**

- [ ] Política: mínimo de 12 caracteres e recusa de senhas comuns (lista local, sem consulta externa).
- [ ] Troca obrigatória quando `password_changed_at` é nulo.
- [ ] Trocar a senha revoga as outras sessões do usuário.

### AUTH-06 · Guard global e usuário atual

**Estimativa:** M · **Marco:** MVP · **Depende de:** AUTH-02

**Critérios de aceite**

- [x] Toda rota exige autenticação por padrão. Rotas públicas (denunciante, login, health) são abertas
      explicitamente (feature 004: guard global do pacote, `@PublicApi`, `OpenAdminRoute()`, `@Public()` no health).
- [x] O usuário e os perfis são lidos do banco a cada requisição. Usuário bloqueado ou desativado perde o acesso na
      hora (feature 004: `PgSessionStore.getSession` + `StaffSessionProvider`).
- [x] O usuário atual fica disponível nos serviços (contexto assíncrono) para a auditoria (AUDIT-03) e a autorização
      (feature 004: `SessionAuthIdentity` → `AuditContext`; `@CurrentUser()` e `request.user` para as políticas).
- [ ] Teste e2e com o fluxo inteiro: login, MFA, rota protegida, logout e rota protegida de novo (401).

### AUTH-07 · CSRF e CORS

**Estimativa:** P · **Marco:** MVP · **Depende de:** AUTH-02

**Critérios de aceite**

- [ ] Proteção CSRF nas rotas administrativas que alteram dados (`app.enableCsrfProtection` do Nest 12, com as
      origens confiáveis do backoffice). O cookie já é `SameSite=Strict` (feature 004).
- [ ] CORS com credenciais só para a origem do backoffice. O portal público não recebe credenciais.
- [ ] Teste: `POST` administrativo vindo de outra origem é recusado.

### AUTH-08 · Rate limit nas rotas de login

**Estimativa:** P · **Marco:** Produção · **Depende de:** AUTH-01, TRV-05

Proteção contra tentativa de adivinhar senha da equipe (não confundir com spam de denúncias, que está fora do escopo).

**Critérios de aceite**

- [ ] `@nestjs/throttler` com storage no Redis em `sign-in` e `mfa/challenge`, por IP e por conta.
- [ ] Resposta 429 com `Retry-After`.
