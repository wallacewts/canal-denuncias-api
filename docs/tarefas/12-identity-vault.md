# 12 · identity-vault

**Objetivo:** guardar a identificação opcional do denunciante com chave própria (`identity-kek`) e revelar só com
justificativa, aprovação de outra pessoa (four-eyes), janela curta e auditoria de cada visualização.

**Depende de:** CRYPTO-02, CRYPTO-03, REP-02, ACL-01, AUDIT-02. IDV-06 é o serviço isolado que faz a cifragem e a decifragem.

---

### IDV-01 · Gravar a identificação no envio

**Estimativa:** M · **Marco:** Produção

- **Entidades:** `ReporterIdentity`, `Report.hasIdentity`.
- **Endpoints:** campo opcional `identity` em `POST /api/public/v1/reports` (REP-02).
- **Auditoria:** coberta por `REPORT_CREATED` (metadata: `hasIdentity: true`, sem os dados).

**Critérios de aceite**

- [ ] Payload mínimo: `name` obrigatório quando houver identificação; `jobTitle` e `contact` opcionais. Nada além
      disso (minimização).
- [ ] DEK própria, gerada com a `identity-kek`, AAD `reporter_identities.payload_enc:<reportId>`.
- [ ] Gravado na mesma transação da denúncia.
- [ ] A identidade nunca aparece em REP-03, REP-04, no histórico, nas mensagens ou nos indicadores (teste).

### IDV-02 · Pedir revelação

**Estimativa:** M · **Marco:** Produção · **Depende de:** IDV-01

- **Entidades:** `IdentityRevealRequest`.
- **Endpoints:** `POST /api/admin/v1/reports/:id/identity-reveal-requests` (`{ justification }`; responsável ou
  gestor com acesso à denúncia).
- **Auditoria:** `IDENTITY_REVEAL_REQUESTED`.

**Critérios de aceite**

- [ ] Só para denúncia com `has_identity = true`.
- [ ] No máximo um pedido `PENDING` por denúncia.
- [ ] Justificativa de 50 a 2.000 caracteres, cifrada com a DEK da denúncia.
- [ ] Notifica os DPOs quando NOT-02 estiver pronta.

### IDV-03 · Listar pedidos

**Estimativa:** P · **Marco:** Produção · **Depende de:** IDV-02

- **Endpoints:** `GET /api/admin/v1/identity-reveal-requests?status=` (perfil `DPO`).
- **Auditoria:** nenhuma (a lista não decifra a identidade).

**Critérios de aceite**

- [ ] Mostra protocolo, categoria, quem pediu, quando e a justificativa decifrada. Não mostra o relato.

### IDV-04 · Aprovar ou rejeitar

**Estimativa:** M · **Marco:** Produção · **Depende de:** IDV-02

- **Endpoints:** `POST /api/admin/v1/identity-reveal-requests/:id/approval` e
  `POST /api/admin/v1/identity-reveal-requests/:id/rejection` (perfil `DPO`).
- **Auditoria:** `IDENTITY_REVEAL_APPROVED`, `IDENTITY_REVEAL_REJECTED`.

**Critérios de aceite**

- [ ] Quem pediu não decide (403 na aplicação, e a CHECK `reveal_four_eyes` garante no banco).
- [ ] A aprovação define `expires_at = agora + identityReveal.windowMinutes`.

### IDV-05 · Ver a identidade

**Estimativa:** M · **Marco:** Produção · **Depende de:** IDV-04

- **Endpoints:** `GET /api/admin/v1/identity-reveal-requests/:id/identity`.
- **Auditoria:** `IDENTITY_REVEALED` a cada chamada.

**Critérios de aceite**

- [ ] Só quem pediu, só com o pedido `APPROVED` e só dentro da janela. Fora dela o pedido vira `EXPIRED` e a resposta
      é 403.
- [ ] Única rota que decifra com a `identity-kek`.
- [ ] Resposta com `Cache-Control: no-store`.
- [ ] Teste: cada visualização gera um registro de auditoria; depois da janela, 403.
- [ ] A decifragem é feita pelo serviço isolado (IDV-06), nunca pela API.

### IDV-06 · Serviço isolado de identidade

**Estimativa:** M · **Marco:** Produção · **Depende de:** CRYPTO-02, IDV-04

Processo separado (container próprio) e o único com credencial na `identity-kek`. Assim, uma falha ou invasão da API
não basta para decifrar identidades. Decidido em 27/11/2026.

- **Arquivos:** `src/identity-worker/` (entrypoint próprio, mesma imagem), serviço `identity-worker` no
  `docker-compose.yml`, AppRole `identity-vault` em `docs/deploy/vault/`.
- **Endpoints:** nenhum público. Comunicação com a API por rede interna (HTTP com mTLS ou fila no Redis), sem porta
  exposta.
- **Auditoria:** `IDENTITY_SEALED` ao gravar e `IDENTITY_DECRYPTED` ao revelar, gravados pelo próprio serviço.

**Critérios de aceite**

- [ ] Gravar: recebe a identificação no envio da denúncia, gera a DEK na `identity-kek` e grava
      `reporter_identities`. A API nunca guarda a identificação em claro além da requisição.
- [ ] Revelar: antes de decifrar, o próprio serviço confere no banco que o pedido está `APPROVED`, dentro da janela,
      que quem aprovou é diferente de quem pediu e que o solicitante é quem está pedindo. Não confia só na API.
- [ ] Usa um perfil de banco próprio, com acesso só a `reporter_identities`, `identity_reveal_requests` (leitura) e
      `audit_logs` (inserção).
- [ ] A credencial do AppRole da API recebe 403 do Vault ao tentar usar a `identity-kek` (teste de integração).
