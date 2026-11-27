# 14 · retention

**Objetivo:** cumprir os prazos de retenção. Calcula quando cada denúncia pode ser expurgada e faz o expurgo por
crypto-shredding, mantendo só os dados estatísticos.

**Depende de:** CAT-03, CASE-01, ATT-05, AUDIT-02, TRV-05.

---

### RET-01 · Cálculo de `retention_until`

**Estimativa:** P · **Marco:** MVP

Função usada pela máquina de estados (CASE-01) ao encerrar.

- **Arquivos:** `src/modules/retention/retention-policy.ts`.

**Critérios de aceite**

- [ ] `INVALID` → `retention.invalidDays`; `UNSUBSTANTIATED` → `retention.unsubstantiatedDays`; `SUBSTANTIATED` e
      `PARTIALLY_SUBSTANTIATED` → `retention.substantiatedDays`, contados a partir de `closed_at`.
- [ ] Testes unitários por desfecho.

### RET-02 · Job de expurgo

**Estimativa:** G · **Marco:** Produção · **Depende de:** RET-01, ATT-05

- **Endpoints:** nenhum (job diário, uma instância só, e comando de CLI para rodar manualmente).
- **Auditoria:** `REPORT_SHREDDED` por denúncia e `RETENTION_RUN` por execução (metadata: quantidade, falhas).

**Critérios de aceite**

- [ ] Seleciona `retention_until < agora`, `shredded_at` nulo e sem legal hold (RET-03), em lotes.
- [ ] Para cada denúncia: apaga os objetos do storage primeiro; depois, numa transação, apaga anexos, mensagens,
      notas, identidade, pedidos de revelação e bloqueios por conflito, zera `justification_enc` do histórico e, em
      `reports`, zera `content_enc` e `wrapped_dek`, troca `access_key_hash` por um marcador e preenche
      `shredded_at`.
- [ ] Mantém categoria, tipo de denunciante, datas, status e desfecho.
- [ ] Idempotente: rodar de novo depois de uma falha no meio termina o serviço sem erro.
- [ ] Backups são mantidos por tempo indeterminado (decidido em 27/11/2026). O expurgo não alcança os backups e isso
      precisa constar no RIPD.
- [ ] Testes: depois do expurgo não há dado decifrável; os indicadores continuam contando a denúncia; a cadeia da
      auditoria continua íntegra; o protocolo antigo recebe 401 no acompanhamento.

### RET-03 · Legal hold

**Estimativa:** M · **Marco:** Produção · **Depende de:** RET-02

Suspende o expurgo de uma denúncia quando há obrigação legal ou processo em andamento (LGPD, art. 16).

- **Arquivos:** migration nova com `reports.legal_hold boolean not null default false` (e motivo cifrado, se o
  jurídico pedir).
- **Endpoints:** `PUT /api/admin/v1/reports/:id/legal-hold` (perfil `DPO`).
- **Auditoria:** `LEGAL_HOLD_CHANGED`.

**Critérios de aceite**

- [ ] Denúncia com legal hold é ignorada pelo RET-02.
- [ ] Teste: ativar, rodar o expurgo, verificar que nada foi apagado.

### RET-04 · Próximos expurgos

**Estimativa:** P · **Marco:** Produção · **Depende de:** RET-01

- **Endpoints:** `GET /api/admin/v1/retention/upcoming?days=30` (perfil `DPO`).
- **Auditoria:** nenhuma (só metadados).

**Critérios de aceite**

- [ ] Lista protocolo, categoria, desfecho e data prevista, sem conteúdo.

### RET-05 · Limpeza de dados auxiliares

**Estimativa:** P · **Marco:** Produção · **Depende de:** TRV-05

**Critérios de aceite**

- [ ] Job diário apaga sessões expiradas ou revogadas há mais de 30 dias, códigos de recuperação usados e marca como
      `EXPIRED` os pedidos de revelação com janela vencida.
