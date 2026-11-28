# 10 · messages

**Objetivo:** conversa anônima entre denunciante e equipe. Para o denunciante, quem responde aparece só como "Equipe
de apuração".

**Depende de:** PUB-02, CASE-01, CRYPTO-03, ACL-02.

---

### MSG-01 · Denunciante envia mensagem

**Estimativa:** M · **Marco:** MVP

- **Entidades:** `Message` (`author_type = REPORTER`, `author_user_id` nulo).
- **Endpoints:** `POST /api/public/v1/me/messages`.
- **Auditoria:** `MESSAGE_SENT` com `actorType = REPORTER`.

**Critérios de aceite**

- [ ] Texto puro de 1 a 5.000 caracteres, cifrado com AAD `messages.body_enc:<id>`.
- [ ] Se a denúncia está em `AWAITING_REPORTER`, volta para `UNDER_INVESTIGATION` pela máquina de estados, na mesma
      transação.
- [ ] Denúncia encerrada (`CONCLUDED`, `INVALID`, `ARCHIVED`) recusa mensagem (409).

### MSG-02 · Denunciante lê as mensagens

**Estimativa:** P · **Marco:** MVP · **Depende de:** MSG-01

- **Endpoints:** `GET /api/public/v1/me/messages`.
- **Auditoria:** `MESSAGES_VIEWED` com `actorType = REPORTER`.

**Critérios de aceite**

- [ ] O autor de cada mensagem vem em **código**: `REPORTER` (o próprio denunciante) ou `TEAM` (equipe), sem id e sem
      nome de quem escreveu. O rótulo "Equipe de apuração" fica no front. Proposta vinda do plano da feature 003 do
      web, aprovada em 2026-11-28.
- [ ] A rota pública devolve só a **data** de cada mensagem (`AAAA-MM-DD`, sem hora), tanto das mensagens da equipe
      quanto das do próprio denunciante: o denunciante e as exportações veem só datas, para que o horário não possa
      ser cruzado com crachá ou VPN (decidido pelo usuário em 2026-11-28). A equipe continua vendo o horário exato
      nas rotas administrativas (MSG-04).
- [ ] Teste: a resposta da rota pública não contém nenhum horário (nem `T`, nem fuso), só a data.
- [ ] Marca as mensagens da equipe como lidas (`read_at`).

### MSG-03 · Equipe envia mensagem

**Estimativa:** P · **Marco:** MVP · **Depende de:** ACL-02

- **Endpoints:** `POST /api/admin/v1/reports/:id/messages`.
- **Auditoria:** `MESSAGE_SENT` com `actorType = STAFF`.

**Critérios de aceite**

- [ ] Só o responsável ou o gestor com acesso (ACL-02).
- [ ] A CHECK `message_author_consistency` é respeitada (STAFF sempre com usuário).

### MSG-04 · Equipe lê as mensagens

**Estimativa:** P · **Marco:** MVP · **Depende de:** ACL-02

- **Endpoints:** `GET /api/admin/v1/reports/:id/messages`.
- **Auditoria:** `MESSAGES_VIEWED`.

**Critérios de aceite**

- [ ] Para a equipe aparece o nome de quem enviou mensagens internas da equipe.
- [ ] Marca as mensagens do denunciante como lidas.

### MSG-05 · Notificação de nova mensagem

**Estimativa:** P · **Marco:** Produção · **Depende de:** NOT-02

**Critérios de aceite**

- [ ] Mensagem do denunciante gera notificação ao responsável, sem conteúdo.
