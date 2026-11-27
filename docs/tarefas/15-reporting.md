# 15 · reporting

**Objetivo:** indicadores agregados para gestão, DPO e auditoria, sem nenhum dado pessoal nem linha por denúncia.

**Depende de:** REP-03, CASE-01, ACL-01.

---

### REPT-01 · Resumo de indicadores

**Estimativa:** M · **Marco:** Produção

- **Endpoints:** `GET /api/admin/v1/reporting/summary?from=&to=` (perfis `COMPLIANCE_MANAGER`, `DPO`, `AUDITOR`).
- **Auditoria:** `REPORTING_VIEWED`.

**Critérios de aceite**

- [ ] Totais por status, categoria, tipo de denunciante e desfecho; quantidade vencida; mediana de tempo até a
      triagem e até o encerramento (a partir de `report_status_history`).
- [ ] Supressão de células pequenas: grupos com menos de 3 denúncias saem como `"<3"`. Numa empresa só, cruzar tipo
      de denunciante com categoria e mês pode identificar alguém.
- [ ] Só consultas sobre colunas em claro. Nada é decifrado.

### REPT-02 · Série mensal

**Estimativa:** P · **Marco:** Produção · **Depende de:** REPT-01

- **Endpoints:** `GET /api/admin/v1/reporting/monthly?months=12`.

**Critérios de aceite**

- [ ] Recebidas e encerradas por mês, com a mesma regra de supressão.

### REPT-03 · Exportação CSV

**Estimativa:** P · **Marco:** Evolução · **Depende de:** REPT-01

- **Endpoints:** `GET /api/admin/v1/reporting/export.csv?from=&to=`.
- **Auditoria:** `REPORTING_EXPORTED` (metadata: período).

**Critérios de aceite**

- [ ] Só agregados, granularidade de dia no máximo, mesma supressão.
