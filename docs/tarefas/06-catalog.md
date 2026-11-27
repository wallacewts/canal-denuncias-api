# 06 · catalog

**Objetivo:** categorias de denúncia e parâmetros do sistema (SLA, retenção, prazos), com o cálculo do prazo de SLA
usado pela tratativa.

**Depende de:** AUDIT-02. As rotas administrativas dependem de ACL-01. A migration `SeedCatalog` já cria as 3
categorias e os valores padrão.

---

### CAT-01 · Categorias para o formulário público

**Estimativa:** P · **Marco:** MVP

- **Entidades:** `Category`.
- **Endpoints:** `GET /api/public/v1/categories` (público).
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [ ] Só categorias ativas, ordenadas por `sort_order`, com `code`, `name` e `description`.
- [ ] `Cache-Control` público de curta duração (é o único dado público que pode ir para cache).

### CAT-02 · Gestão de categorias

**Estimativa:** P · **Marco:** Produção · **Depende de:** ACL-01

- **Endpoints:** `GET`, `POST /api/admin/v1/categories` e `PATCH /api/admin/v1/categories/:id` (perfil `ADMIN`).
- **Auditoria:** `CATEGORY_CREATED`, `CATEGORY_UPDATED`.

**Critérios de aceite**

- [ ] Sem exclusão: categoria em uso só é desativada (`active = false`), porque `reports` tem FK para ela.
- [ ] `code` imutável depois de criado.

### CAT-03 · Serviço de configurações

**Estimativa:** M · **Marco:** MVP

- **Entidades:** `Setting`.
- **Endpoints:** `GET /api/admin/v1/settings` e `PUT /api/admin/v1/settings/:key` (`ADMIN` para SLA e prazos; `DPO`
  para `retention.*`).
- **Auditoria:** `SETTING_UPDATED` (metadata: chave, valor anterior e novo, só números).

**Critérios de aceite**

- [ ] Schema por chave (ex.: `sla.triageHours` inteiro entre 1 e 720). Chave desconhecida é recusada.
- [ ] Leitura tipada para os outros módulos (`settings.get('sla.triageHours')`), com cache em memória invalidado na
      alteração.
- [ ] Mudança de prazo de retenção vale para encerramentos futuros, não recalcula os já encerrados (decisão a
      confirmar, ver README).

### CAT-04 · Cálculo do prazo de SLA

**Estimativa:** P · **Marco:** MVP · **Depende de:** CAT-03

Função pura usada por reports e case-management.

- **Arquivos:** `src/modules/catalog/sla.ts`.

**Critérios de aceite**

- [ ] `RECEIVED` e `IN_TRIAGE`: `due_at = início + sla.triageHours`.
- [ ] `UNDER_INVESTIGATION`: `due_at = início + sla.investigationDays`.
- [ ] `AWAITING_REPORTER`: o SLA da equipe fica suspenso (`due_at` nulo) e o prazo de resposta do denunciante
      (`reporter.replyDeadlineDays`) passa a valer. Decidido em 27/11/2026.
- [ ] Ao sair de `AWAITING_REPORTER`, o prazo da equipe é recalculado a partir da retomada.
- [ ] Status finais: `due_at` nulo.
- [ ] Testes unitários para cada status.
