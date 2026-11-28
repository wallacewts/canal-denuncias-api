# 03 · users

**Objetivo:** cadastro e gestão da equipe interna e dos perfis (`ADMIN`, `COMPLIANCE_MANAGER`, `ANALYST`, `DPO`,
`AUDITOR`). Usuários nunca são apagados, só desativados.

**Depende de:** AUDIT-02. As rotas administrativas dependem de AUTH-06 e ACL-01.

> **Já existe (feature 004, D53 e D54):** status e perfis são relidos do banco a cada requisição (mudança vale na
> requisição seguinte; só `ACTIVE` entra), `PgSessionStore.deleteUserSessions` encerra as sessões de um usuário,
> `MfaService.disable` remove o MFA e as rotas declaram permissão com `@Can()`. A regra "ninguém altera os próprios
> perfis" tem exemplo provado em `test/contract/auth/example/example.policy.ts`. Detalhes em
> `docs/adr/0053-autenticacao-e-autorizacao.md`.

---

### USERS-01 · Repositório de usuários

> Entregue na feature 001 (TRV-09), conforme a D33.

**Estimativa:** P · **Marco:** MVP

- **Arquivos:** `src/modules/users/users.repository.ts`.
- **Entidades:** `User`, `UserRole`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] `findCredentialsByEmail` é o único método que lê `password_hash` (coluna com `select: false`).
- [x] Os demais métodos devolvem o usuário com os perfis e sem hash nem segredo de MFA.
- [x] E-mail único tratado pela constraint (409 na violação, sem consultar antes).

### USERS-02 · Criar usuário

**Estimativa:** M · **Marco:** MVP · **Depende de:** USERS-01, AUTH-05

- **Arquivos:** `src/modules/users/users.controller.ts`, `users.service.ts`.
- **Endpoints:** `POST /api/admin/v1/users` (perfil `ADMIN`).
- **Auditoria:** `USER_CREATED` (metadata: perfis atribuídos).

**Critérios de aceite**

- [ ] Recebe nome, e-mail e perfis. Gera uma senha provisória forte, exibida **uma única vez** na resposta.
- [ ] `password_changed_at` fica nulo, o que obriga a troca de senha e o cadastro do MFA no primeiro login.
- [ ] Respeita a regra de segregação de USERS-05.
- [ ] Teste: senha provisória não aparece em log nem na auditoria.

### USERS-03 · Listar e detalhar usuários

**Estimativa:** P · **Marco:** MVP · **Depende de:** USERS-01, TRV-08

- **Endpoints:** `GET /api/admin/v1/users?status=&role=&after=&limit=` e `GET /api/admin/v1/users/:id` (perfil
  `ADMIN`).
- **Auditoria:** nenhuma (não contém dado de denúncia).

**Critérios de aceite**

- [ ] Resposta sem hash, sem segredo de MFA, com `mfaEnabled` (booleano) e `lastLoginAt`.

### USERS-04 · Alterar dados e status

**Estimativa:** P · **Marco:** MVP · **Depende de:** USERS-01

- **Endpoints:** `PATCH /api/admin/v1/users/:id` (nome) e `PUT /api/admin/v1/users/:id/status` (`ACTIVE`, `BLOCKED`,
  `DISABLED`) (perfil `ADMIN`).
- **Auditoria:** `USER_UPDATED`, `USER_STATUS_CHANGED` (metadata: status anterior e novo).

**Critérios de aceite**

- [ ] Bloquear ou desativar revoga todas as sessões do usuário na hora.
- [ ] Usuário com denúncias atribuídas não pode ser desativado: a operação é recusada (409, informando a quantidade)
      até o Gestor reatribuir. Bloquear continua sempre permitido e imediato (para conta comprometida, bloquear antes
      e desativar depois). Decidido em 28/11/2026 (feature 005).
- [ ] O ADMIN não pode desativar a si mesmo.

### USERS-05 · Gerenciar perfis

**Estimativa:** M · **Marco:** MVP · **Depende de:** USERS-01

- **Endpoints:** `PUT /api/admin/v1/users/:id/roles` (perfil `ADMIN`).
- **Auditoria:** `USER_ROLES_CHANGED` (metadata: perfis antes e depois).

**Critérios de aceite**

- [ ] Não permite ficar sem nenhum ADMIN ativo (contagem e alteração na mesma transação).
- [ ] `ADMIN` pode acumular perfis que leem denúncias (decidido em 27/11/2026).
- [ ] Ninguém altera os próprios perfis: a mudança precisa ser feita por outro `ADMIN` (403). Sem isso, um `ADMIN`
      poderia se conceder acesso às denúncias sozinho.
- [ ] Mudança de perfil vale na próxima requisição (perfis lidos do banco, não do token).
- [ ] Remover `ANALYST` de quem tem denúncias atribuídas segue a mesma regra de USERS-04.

### USERS-06 · Resetar MFA de outro usuário

**Estimativa:** P · **Marco:** MVP · **Depende de:** USERS-01, AUTH-03

- **Endpoints:** `POST /api/admin/v1/users/:id/mfa-reset` (perfil `ADMIN`).
- **Auditoria:** `USER_MFA_RESET`.

**Critérios de aceite**

- [ ] Limpa `mfa_secret_enc` e `mfa_enabled_at`, apaga os códigos de recuperação e revoga as sessões.
- [ ] O ADMIN não reseta o próprio MFA por esta rota.

### USERS-07 · Meu perfil

**Estimativa:** P · **Marco:** MVP · **Depende de:** AUTH-06

- **Endpoints:** `GET /api/admin/v1/me`.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [ ] Retorna id, nome, e-mail, perfis, situação do MFA e se a troca de senha é obrigatória.
- [ ] As permissões efetivas (lista de habilidades) vêm junto, calculadas pelas mesmas políticas do servidor (D54). O
      front decide menu e rotas só por elas e não copia a matriz de perfis; o servidor continua checando cada rota.
      (Proposta do front, feature 004 do backoffice.)
- [ ] Formato das permissões: códigos estáveis `recurso.ação` (ex.: `reports.list`, `reports.read`, `users.manage`,
      `audit.read`), um por habilidade da matriz do ACL-01 (mapeamento em
      `docs/adr/0053-autenticacao-e-autorizacao.md`). Habilidade que depende do registro (ex.: ler uma denúncia só se
      atribuída) indica só que o usuário pode exercê-la em algum registro; a decisão final continua no servidor.
      (Proposta do front.)
- [ ] Devolve os horários de expiração da sessão em ISO 8601 UTC: inatividade (último uso + 15 min) e absoluta
      (login + 8 h), para o front avisar antes de cada um. Como toda requisição autenticada conta como uso, o front não
      deve chamar `/me` só para manter a sessão viva. (Proposta do front, feature 004 do backoffice.)
