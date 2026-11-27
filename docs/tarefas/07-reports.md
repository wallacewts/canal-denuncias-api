# 07 · reports

**Objetivo:** criar e ler denúncias. Gera protocolo e chave, cifra o relato inteiro e mostra para a equipe só o que
cada perfil pode ver.

**Depende de:** CRYPTO-03, AUDIT-02, CAT-03, CAT-04. As rotas administrativas dependem de ACL-02 e ACL-03.

---

### REP-01 · Protocolo e chave do denunciante

**Estimativa:** P · **Marco:** MVP

- **Arquivos:** `src/modules/reports/protocol.ts`.
- **Entidades:** `Report.protocol`, `Report.accessKeyHash`.

**Critérios de aceite**

- [ ] Protocolo no formato `DV-XXXXX-XXXXX` em base32 Crockford (sem I, L, O, U), gerado com `crypto.randomInt`.
      Nunca sequencial. Cabe em `varchar(16)`.
- [ ] Chave com 128 bits de entropia, exibida em grupos para facilitar anotar (ex.: 26 caracteres base32 em blocos
      de 4 ou 5).
- [ ] No banco fica só o hash da chave, com o mesmo algoritmo das senhas (definido em AUTH-00).
- [ ] Protocolo duplicado (violação de unique) gera outro e tenta de novo, até 3 vezes.
- [ ] Testes: formato, alfabeto, tentativa nova em colisão.

### REP-02 · Envio da denúncia

**Estimativa:** G · **Marco:** MVP · **Depende de:** REP-01

- **Entidades:** `Report`, `ReportStatusHistory` (e `ReporterIdentity` quando IDV-01 estiver pronta).
- **Endpoints:** `POST /api/public/v1/reports` (público).
- **Auditoria:** `REPORT_CREATED` com `actorType = REPORTER`, sem IP.

Corpo: `reporterType`, `categoryCode` e os campos de `ReportContentV1` (`description`, `occurredOn`, `location`,
`affectedSystems`, `dataTypes`, `involved`, `howKnown`, `evidenceNotes`).

**Critérios de aceite**

- [ ] Limites: `description` de 100 a 10.000 caracteres; os demais textos até 2.000; até 20 envolvidos.
- [ ] Ordem: gera o id (UUID v7) na aplicação, pede a DEK ao Vault, cifra o JSON com AAD
      `reports.content_enc:<id>` e só então abre a transação. Na transação: insere a denúncia (`status = RECEIVED`,
      `due_at` pelo CAT-04), o histórico (`RECEIVED`, ator `REPORTER`) e a auditoria.
- [ ] Resposta 201 com `protocol`, `accessKey` (única vez em que aparece) e `receivedOn` (só a data).
- [ ] Teste: nenhum trecho da descrição aparece no banco em claro, no log da requisição, na auditoria nem em
      resposta de erro.
- [ ] Teste: a auditoria tem `ip` e `user_agent` nulos.
- [ ] Se o formulário trouxer identificação antes de IDV-01 estar pronta, a API recusa (400). A identificação
      opcional só é liberada junto com IDV-01.

### REP-03 · Listagem para a equipe

**Estimativa:** M · **Marco:** MVP · **Depende de:** ACL-03, TRV-08

- **Endpoints:** `GET /api/admin/v1/reports?status=&categoryId=&priority=&assignedTo=me|<id>&overdue=&after=&limit=`.
- **Auditoria:** `REPORT_LIST_VIEWED` (metadata: filtros).

**Critérios de aceite**

- [ ] Retorna só metadados em claro (protocolo, categoria, tipo de denunciante, status, prioridade, responsável,
      `received_at`, `due_at`, vencido ou não). **Nada é decifrado na listagem.**
- [ ] Filtrado pela política (ACL-03).
- [ ] Ordenação padrão: vencidas primeiro, depois por `due_at`.

### REP-04 · Detalhe da denúncia

**Estimativa:** M · **Marco:** MVP · **Depende de:** ACL-02, CRYPTO-03

- **Endpoints:** `GET /api/admin/v1/reports/:id`.
- **Auditoria:** `REPORT_VIEWED`.

**Critérios de aceite**

- [ ] Decifra `content_enc` e devolve o relato junto com os metadados.
- [ ] Não inclui identidade, só `hasIdentity` (a identidade só sai pelo fluxo de IDV-05).
- [ ] Denúncia expurgada responde 410.
- [ ] Toda abertura gera `REPORT_VIEWED`, inclusive repetida.

### REP-05 · Testes de não vazamento

**Estimativa:** M · **Marco:** MVP · **Depende de:** REP-02, REP-04

**Critérios de aceite**

- [ ] Teste e2e que envia uma denúncia com textos-marcador e verifica que nenhum deles aparece em: linhas de log,
      `audit_logs.metadata`, respostas de erro forçado e tabelas em claro (consulta direta ao banco).
