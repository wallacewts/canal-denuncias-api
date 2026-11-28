# 02 · audit

**Objetivo:** trilha de auditoria append-only com cadeia de hash. Registra quem fez o quê, quando e com que resultado,
sem guardar conteúdo de denúncia nem dado pessoal em `metadata`.

**Depende de:** TRV-01, TRV-10. A tabela, os triggers e o `REVOKE` já existem (migrations `InitialSchema` e
`AuditImmutability`).

---

### AUDIT-01 · Catálogo de ações

**Estimativa:** P · **Marco:** MVP

Enum `AuditAction` e tipos de recurso usados por todos os módulos.

- **Arquivos:** `src/modules/audit/audit-action.enum.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** define o catálogo.

**Critérios de aceite**

- [ ] Ações iniciais: `AUTH_LOGIN_SUCCEEDED`, `AUTH_LOGIN_FAILED`, `AUTH_LOGOUT`, `AUTH_MFA_ENROLLED`,
      `AUTH_MFA_FAILED`, `AUTH_RECOVERY_CODE_USED`, `AUTH_PASSWORD_CHANGED`, `AUTH_SESSION_REVOKED`,
      `AUTH_TOKEN_REUSED`, `USER_CREATED`, `USER_UPDATED`, `USER_STATUS_CHANGED`, `USER_ROLES_CHANGED`,
      `USER_MFA_RESET`, `ACCESS_DENIED`, `CATEGORY_CREATED`, `CATEGORY_UPDATED`, `SETTING_UPDATED`,
      `REPORT_CREATED`, `REPORT_LIST_VIEWED`, `REPORT_VIEWED`, `REPORT_STATUS_CHANGED`, `REPORT_PRIORITY_CHANGED`,
      `REPORT_ASSIGNED`, `REPORT_UNASSIGNED`, `REPORT_ACCESS_BLOCKED`, `REPORT_ACCESS_UNBLOCKED`,
      `INTERNAL_NOTE_CREATED`, `INTERNAL_NOTES_VIEWED`, `REPORTER_ACCESS_GRANTED`, `REPORTER_ACCESS_DENIED`,
      `REPORTER_REPORT_VIEWED`, `MESSAGE_SENT`, `MESSAGES_VIEWED`, `ATTACHMENT_UPLOADED`, `ATTACHMENT_REJECTED`,
      `ATTACHMENT_DOWNLOADED`, `ATTACHMENT_INTEGRITY_FAILED`, `IDENTITY_REVEAL_REQUESTED`,
      `IDENTITY_REVEAL_APPROVED`, `IDENTITY_REVEAL_REJECTED`, `IDENTITY_REVEALED`, `LEGAL_HOLD_CHANGED`,
      `REPORT_SHREDDED`, `RETENTION_RUN`, `KEYS_REWRAPPED`, `AUDIT_LOG_VIEWED`, `AUDIT_CHAIN_VERIFIED`,
      `REPORTING_VIEWED`, `REPORTING_EXPORTED`.
- [ ] Tamanho de cada nome cabe em `action varchar(60)`.

### AUDIT-02 · Gravação com cadeia de hash

> Núcleo entregue na feature 001 (TRV-09), conforme a D33. O hash inclui também `ip` e `user_agent`.

**Estimativa:** G · **Marco:** MVP · **Depende de:** AUDIT-01

`AuditService.record()`, o único jeito de escrever na trilha.

- **Arquivos:** `src/modules/audit/audit.service.ts`, `audit-hash.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** é a própria gravação.

**Critérios de aceite**

- [x] Dentro de uma transação: `pg_advisory_xact_lock(<constante>)`, lê o último `hash`, calcula
      `sha256(prev_hash || occurred_at || actor_type || actor_user_id || action || resource_type || resource_id || result || metadata_canônico)`
      e insere.
- [x] `metadata` serializado de forma canônica (chaves ordenadas), para o hash ser reproduzível.
- [x] Primeiro registro usa `prev_hash` de 32 bytes zerados (gênese).
- [x] Aceita um `EntityManager` opcional, para gravar na mesma transação da operação auditada (a operação e o
      registro confirmam ou desfazem juntos).
- [x] `occurred_at` é definido pela aplicação antes do hash (não pelo default do banco), para o hash bater com o valor
      salvo.
- [x] `occurred_at` é gravado com o horário exato para todos os atores, inclusive `REPORTER` (decidido em
      27/11/2026). Por isso, a leitura da trilha fica restrita ao perfil `AUDITOR`.
- [x] Teste: 50 gravações concorrentes geram uma cadeia válida e sem bifurcação.

### AUDIT-03 · Contexto do ator

**Estimativa:** M · **Marco:** MVP · **Depende de:** AUDIT-02, AUTH-06

O serviço descobre o ator sozinho, a partir do contexto da requisição.

- **Arquivos:** `src/modules/audit/audit-context.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** preenche `actor_type`, `actor_user_id`, `ip` e `user_agent`.

**Critérios de aceite**

- [ ] Equipe interna: `STAFF`, id do usuário, IP real (via `trust proxy`) e user-agent truncado em 255.
- [ ] Denunciante: `REPORTER`, sem usuário, **sem IP e sem user-agent**.
- [ ] Jobs e CLI: `SYSTEM`, sem IP.
- [ ] Teste: uma rota pública gera registro com `ip` e `user_agent` nulos, mesmo com `X-Forwarded-For` na
      requisição.

### AUDIT-04 · Auditoria declarativa nas rotas

**Estimativa:** M · **Marco:** MVP · **Depende de:** AUDIT-03

Decorator `@Audited(action, resourceType, resolverDoId)` mais interceptor, para não repetir código nos controllers.

- **Arquivos:** `src/modules/audit/audited.decorator.ts`, `audit.interceptor.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** `SUCCESS` quando o handler termina, `DENIED` em 403 e `FAILURE` em erro.

**Critérios de aceite**

- [ ] Operações que mudam dados continuam gravando dentro da própria transação (AUDIT-02). O decorator serve para
      leituras e para casos simples.
- [ ] Teste de um handler que lança 403 e gera registro `DENIED`.

### AUDIT-05 · Proteção do campo metadata

**Estimativa:** P · **Marco:** MVP · **Depende de:** AUDIT-01

**Critérios de aceite**

- [ ] `metadata` tipado por ação (ex.: `REPORT_STATUS_CHANGED` aceita `{ from, to, outcome }`). Campo de texto livre
      não é aceito.
- [ ] Teste: gravar `metadata` com chave fora do schema falha.

### AUDIT-06 · Consulta da trilha

**Estimativa:** M · **Marco:** Produção · **Depende de:** AUDIT-02, ACL-01, TRV-08

- **Arquivos:** `src/modules/audit/audit.controller.ts`.
- **Endpoints:** `GET /api/admin/v1/audit-logs?actorUserId=&action=&resourceType=&resourceId=&from=&to=&after=&limit=`
  (perfil `AUDITOR`).
- **Auditoria:** `AUDIT_LOG_VIEWED` (metadata: filtros usados).

**Critérios de aceite**

- [ ] Paginação por cursor em ordem decrescente de `id`.
- [ ] Outros perfis recebem 403.

### AUDIT-07 · Verificação de integridade da cadeia

**Estimativa:** M · **Marco:** Produção · **Depende de:** AUDIT-02

- **Arquivos:** `src/modules/audit/audit-verifier.service.ts`, `src/cli/verify-audit.command.ts`.
- **Endpoints:** `POST /api/admin/v1/audit-logs/verification` (perfil `AUDITOR`).
- **Auditoria:** `AUDIT_CHAIN_VERIFIED` (metadata: resultado, registros verificados, primeiro id quebrado).

**Critérios de aceite**

- [ ] Recalcula a cadeia em lotes (streaming), sem carregar a tabela inteira.
- [ ] Resposta `{ ok, checked, firstBrokenId }`.
- [ ] Também disponível por CLI, para rodar agendado.
- [ ] Teste: cadeia íntegra passa; registro adulterado por superusuário (com o trigger desligado só no teste) é
      detectado.

### AUDIT-08 · Teste automatizado de imutabilidade

**Estimativa:** P · **Marco:** MVP

Hoje a imutabilidade foi verificada à mão. Automatizar no e2e do CI.

**Critérios de aceite**

- [ ] Com `app_runtime`: `UPDATE` e `DELETE` em `audit_logs` falham por permissão.
- [ ] Com `app_migrator`: `UPDATE`, `DELETE` e `TRUNCATE` falham pelo trigger.
- [ ] `INSERT` com `actor_type = REPORTER` e `ip` preenchido falha pela CHECK.

### AUDIT-09 · Retenção e particionamento da trilha

**Estimativa:** G · **Marco:** Evolução

**Critérios de aceite**

- [ ] Prazo de guarda da trilha definido com o jurídico e o DPO.
- [ ] Se o volume justificar, particionar por mês, sem quebrar a verificação da cadeia.
