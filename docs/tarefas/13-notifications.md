# 13 · notifications

**Objetivo:** avisar a equipe interna por e-mail, sem nenhum conteúdo de denúncia. O denunciante nunca recebe
e-mail (decisão D06).

**Depende de:** TRV-05, USERS-01, CAT-03.

---

### NOT-01 · Envio de e-mail pela fila

**Estimativa:** M · **Marco:** Produção

- **Arquivos:** `src/modules/notifications/`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma (o e-mail não contém dado de denúncia).

**Critérios de aceite**

- [ ] Decidir entre `nodemailer` direto e o pacote oficial `@nestjs/mail` (registrar no ADR).
- [ ] Envio sempre pela fila `notifications`, com tentativas, `backoff` e `jobId` idempotente.
- [ ] Modelos em português, texto puro, com um link genérico para o backoffice.
- [ ] Nenhum e-mail contém protocolo, trecho de relato, categoria ou nome de envolvido. Teste que renderiza cada
      modelo e procura esses dados.
- [ ] Em desenvolvimento, os e-mails chegam no Mailpit.

### NOT-02 · Eventos que geram aviso

**Estimativa:** M · **Marco:** Produção · **Depende de:** NOT-01

| Evento                  | Quem recebe                   |
| ----------------------- | ----------------------------- |
| Nova denúncia           | Todos os `COMPLIANCE_MANAGER` |
| Denúncia atribuída      | O analista                    |
| Mensagem do denunciante | O responsável                 |
| Pedido de revelação     | Todos os `DPO`                |
| Decisão sobre revelação | Quem pediu                    |

**Critérios de aceite**

- [ ] Os módulos publicam eventos de domínio e um ouvinte transforma em job. O ouvinte não engole erro em silêncio.
- [ ] Usuário bloqueado ou desativado não recebe.

### NOT-03 · Resumo diário de SLA

**Estimativa:** P · **Marco:** Produção · **Depende de:** NOT-01

**Critérios de aceite**

- [ ] Job diário (uma instância só, com fuso `America/Sao_Paulo`) envia a cada responsável e aos gestores a
      quantidade de denúncias vencidas e a vencer em 24 h. Só números.
