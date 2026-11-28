# 09 · case-management

**Objetivo:** tratar a denúncia. Máquina de estados, atribuição, prioridade, conflito de interesse, notas internas e
histórico.

**Depende de:** REP-04, ACL-02, CAT-04, AUDIT-02, CRYPTO-03.

---

### CASE-01 · Máquina de estados

**Estimativa:** G · **Marco:** MVP

- **Arquivos:** `src/modules/case-management/report-state-machine.ts`, `transition.service.ts`.
- **Entidades:** `Report`, `ReportStatusHistory`.

| De                                         | Para                  | Quem                                      | Exige                           |
| ------------------------------------------ | --------------------- | ----------------------------------------- | ------------------------------- |
| `RECEIVED`                                 | `IN_TRIAGE`           | COMPLIANCE_MANAGER                        | —                               |
| `IN_TRIAGE`                                | `UNDER_INVESTIGATION` | COMPLIANCE_MANAGER                        | responsável atribuído           |
| `IN_TRIAGE`                                | `INVALID`             | COMPLIANCE_MANAGER                        | justificativa                   |
| `UNDER_INVESTIGATION`                      | `AWAITING_REPORTER`   | responsável ou gestor                     | mensagem enviada ao denunciante |
| `AWAITING_REPORTER`                        | `UNDER_INVESTIGATION` | denunciante (ao responder) ou responsável | —                               |
| `UNDER_INVESTIGATION`, `AWAITING_REPORTER` | `CONCLUDED`           | responsável ou gestor                     | desfecho e justificativa        |
| `CONCLUDED`, `INVALID`                     | `ARCHIVED`            | COMPLIANCE_MANAGER                        | —                               |

**Critérios de aceite**

- [ ] Tabela de transições em código, numa função pura, com testes para cada transição válida e inválida.
- [ ] A mudança é um `UPDATE ... WHERE id = :id AND status = :de` e confere as linhas afetadas. Duas transições
      simultâneas: uma vence e a outra recebe 409.
- [ ] Na mesma transação: atualiza status, `due_at` (CAT-04), `closed_at` e `retention_until` (RET-01) quando encerra,
      grava `report_status_history` (justificativa cifrada com a DEK da denúncia) e grava a auditoria.
- [ ] A CHECK `report_outcome_only_when_closed` é respeitada: desfecho só em `CONCLUDED`.

### CASE-02 · Endpoint de transição

**Estimativa:** P · **Marco:** MVP · **Depende de:** CASE-01

- **Endpoints:** `POST /api/admin/v1/reports/:id/transitions`, corpo `{ to, outcome?, justification? }`.
- **Auditoria:** `REPORT_STATUS_CHANGED` (metadata: `from`, `to`, `outcome`).

**Critérios de aceite**

- [ ] Transição inválida: 409 com o código do motivo. Falta de requisito (desfecho, justificativa, responsável): 400.

### CASE-03 · Atribuição

**Estimativa:** M · **Marco:** MVP · **Depende de:** ACL-02

- **Entidades:** `ReportAssignment`, `Report.assignedToId`.
- **Endpoints:** `PUT /api/admin/v1/reports/:id/assignee` (`{ userId }`) e `DELETE /api/admin/v1/reports/:id/assignee`
  (perfil `COMPLIANCE_MANAGER`).
- **Auditoria:** `REPORT_ASSIGNED`, `REPORT_UNASSIGNED`.

**Critérios de aceite**

- [ ] Só aceita usuário ativo com perfil `ANALYST` e sem bloqueio por conflito naquela denúncia.
- [ ] A atribuição trava a linha do analista (`SELECT … FOR SHARE`) e confere status e perfil na mesma transação,
      para não escapar da regra que impede desativar quem tem denúncias abertas atribuídas (feature 005, research R4).
- [ ] Fecha a atribuição anterior (`released_at`) e abre a nova, na mesma transação.
- [ ] Gera notificação para o analista quando NOT-02 estiver pronta.

### CASE-04 · Prioridade

**Estimativa:** P · **Marco:** MVP · **Depende de:** ACL-02

- **Endpoints:** `PUT /api/admin/v1/reports/:id/priority` (perfil `COMPLIANCE_MANAGER`).
- **Auditoria:** `REPORT_PRIORITY_CHANGED`.

### CASE-05 · Conflito de interesse

**Estimativa:** M · **Marco:** MVP · **Depende de:** ACL-02

- **Entidades:** `ReportAccessBlock`.
- **Endpoints:** `POST /api/admin/v1/reports/:id/access-blocks` (`{ userId, reason }`, perfil `COMPLIANCE_MANAGER`),
  `DELETE /api/admin/v1/reports/:id/access-blocks/:userId` e `POST /api/admin/v1/reports/:id/access-blocks/me` (o
  próprio usuário declara conflito).
- **Auditoria:** `REPORT_ACCESS_BLOCKED`, `REPORT_ACCESS_UNBLOCKED`.

**Critérios de aceite**

- [ ] Motivo cifrado com a DEK da denúncia.
- [ ] Bloquear o responsável atual desfaz a atribuição na mesma transação.
- [ ] Quem declara conflito sobre si mesmo perde o acesso na hora.
- [ ] Só remove bloqueio quem tem perfil de gestor e não está bloqueado naquela denúncia.

### CASE-06 · Notas internas

**Estimativa:** M · **Marco:** MVP · **Depende de:** CRYPTO-03

- **Entidades:** `InternalNote`.
- **Endpoints:** `POST` e `GET /api/admin/v1/reports/:id/notes`.
- **Auditoria:** `INTERNAL_NOTE_CREATED`, `INTERNAL_NOTES_VIEWED`.

**Critérios de aceite**

- [ ] Texto até 5.000 caracteres, cifrado com AAD `internal_notes.body_enc:<id>`.
- [ ] Nenhuma rota pública expõe notas (teste).

### CASE-07 · Histórico

**Estimativa:** P · **Marco:** MVP · **Depende de:** CASE-01, CASE-03

- **Endpoints:** `GET /api/admin/v1/reports/:id/history`.
- **Auditoria:** coberta por `REPORT_VIEWED`.

**Critérios de aceite**

- [ ] Linha do tempo única com mudanças de status (com justificativa decifrada), atribuições e bloqueios.

### CASE-08 · Prazo de resposta do denunciante

**Estimativa:** P · **Marco:** Produção · **Depende de:** CASE-01, TRV-05

**Critérios de aceite**

- [ ] Job diário marca as denúncias em `AWAITING_REPORTER` com prazo vencido, para aparecerem no filtro de vencidas.
- [ ] Não muda status sozinho: quem encerra por falta de resposta é a equipe.
