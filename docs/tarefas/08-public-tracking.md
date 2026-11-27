# 08 · public-tracking

**Objetivo:** acesso anônimo do denunciante à própria denúncia com protocolo e chave: andamento, linha do tempo e
porta de entrada para mensagens e anexos.

**Depende de:** REP-01, REP-02, AUDIT-03.

---

### PUB-01 · Abrir acesso com protocolo e chave

**Estimativa:** M · **Marco:** MVP

- **Endpoints:** `POST /api/public/v1/tracking/sessions` (público), corpo `{ protocol, accessKey }`.
- **Auditoria:** `REPORTER_ACCESS_GRANTED` (recurso: id da denúncia) e `REPORTER_ACCESS_DENIED` (sem `resourceId`; o
  protocolo tentado não é gravado).

**Critérios de aceite**

- [ ] Protocolo e chave vão no corpo, nunca na URL.
- [ ] Protocolo inexistente também verifica um hash fictício, para o tempo de resposta ser igual ao de chave errada.
- [ ] Erro sempre 401 genérico, inclusive para denúncia expurgada.
- [ ] Sucesso devolve um token de 15 minutos, válido só para aquela denúncia (`sub` = id da denúncia, audiência
      `reporter`), assinado com segredo próprio de 32 bytes ou mais. O token vai no corpo e o portal guarda só em
      memória.
- [ ] Teste: o token de uma denúncia não acessa outra.

### PUB-02 · Guard do denunciante

**Estimativa:** P · **Marco:** MVP · **Depende de:** PUB-01

**Critérios de aceite**

- [ ] Rotas `/api/public/v1/me/*` exigem o token do denunciante no cabeçalho `Authorization: Bearer`.
- [ ] Recusa token expirado, de outra audiência ou de denúncia expurgada (401).
- [ ] Token de usuário da equipe não serve aqui, e token de denunciante não serve nas rotas administrativas.

### PUB-03 · Consultar andamento

**Estimativa:** M · **Marco:** MVP · **Depende de:** PUB-02

- **Endpoints:** `GET /api/public/v1/me/report`.
- **Auditoria:** `REPORTER_REPORT_VIEWED`.

**Critérios de aceite**

- [ ] Status traduzido para rótulos públicos: `RECEIVED` → Recebida; `IN_TRIAGE` e `UNDER_INVESTIGATION` → Em
      análise; `AWAITING_REPORTER` → Aguardando sua resposta (com prazo); `INVALID` → Encerrada; `CONCLUDED` e `ARCHIVED` →
      Concluída, com o desfecho.
- [ ] Linha do tempo só com datas (sem hora), sem justificativas internas e sem nome de quem tratou.
- [ ] O denunciante vê o desfecho: Procedente, Parcialmente procedente ou Improcedente (decidido em 27/11/2026). As
      justificativas internas continuam sem aparecer.
- [ ] Mostra a categoria e a data de recebimento. O relato original não é devolvido (minimização).

### PUB-04 · Encerrar o acesso

**Estimativa:** P · **Marco:** Produção · **Depende de:** PUB-01, TRV-05

- **Endpoints:** `DELETE /api/public/v1/tracking/sessions/current`.

**Critérios de aceite**

- [ ] O token entra numa lista de revogados no Redis até expirar.
- [ ] Depois de encerrar, o mesmo token recebe 401.
