# 11 · attachments

**Objetivo:** anexos de evidência enviados pelo denunciante ou pela equipe. Antivírus, remoção de metadados,
validação do tipo real do arquivo e armazenamento cifrado com nome aleatório.

**Depende de:** CRYPTO-04, TRV-06, PUB-02, ACL-02.

---

### ATT-01 · Pipeline de recebimento

**Estimativa:** G · **Marco:** Produção

Serviço único usado pelos dois uploads (denunciante e equipe).

- **Arquivos:** `src/modules/attachments/ingest.service.ts`.
- **Entidades:** `Attachment`.

**Critérios de aceite**

- [ ] Limites: 10 MB por arquivo e no máximo 5 arquivos por denúncia enviados pelo denunciante (configurável em
      `settings`).
- [ ] Tipo validado pelo conteúdo com `file-type`, numa lista permitida (PDF, PNG, JPEG, TXT; outros só com decisão
      registrada). Extensão e `Content-Type` enviados são ignorados.
- [ ] Remoção de metadados: imagens reprocessadas (`sharp`, sem EXIF e sem GPS) e PDFs limpos de autor e software.
- [ ] Varredura no ClamAV **antes** de cifrar e gravar, no próprio upload. Com ClamAV fora do ar, o upload é recusado
      (503): falha fechada.
- [ ] Arquivo limpo é cifrado em streaming com a DEK da denúncia e gravado com `storage_key` aleatória. O nome
      original vai cifrado.
- [ ] Linha em `attachments` com `scan_status = CLEAN`, gravada só depois de o objeto existir no storage. Falha no
      meio do caminho não deixa objeto sem registro (limpeza garantida).
- [ ] Testes: foto com GPS sai sem GPS; `.exe` renomeado para `.pdf` é recusado; arquivo de teste EICAR é recusado;
      o objeto no storage não contém o texto original.

### ATT-02 · Upload pelo denunciante

**Estimativa:** P · **Marco:** Produção · **Depende de:** ATT-01

- **Endpoints:** `POST /api/public/v1/me/attachments` (multipart; `messageId` opcional para anexar a uma mensagem).
- **Auditoria:** `ATTACHMENT_UPLOADED` ou `ATTACHMENT_REJECTED` (metadata: motivo codificado), `actorType =
REPORTER`.

**Critérios de aceite**

- [ ] Funciona logo depois do envio da denúncia, com o token de acompanhamento (o portal abre o acesso
      automaticamente com o protocolo e a chave recém-criados).
- [ ] Denúncia encerrada recusa anexos.

### ATT-03 · Upload pela equipe

**Estimativa:** P · **Marco:** Produção · **Depende de:** ATT-01

- **Endpoints:** `POST /api/admin/v1/reports/:id/attachments`.
- **Auditoria:** `ATTACHMENT_UPLOADED`, `actorType = STAFF`.

### ATT-04 · Download

**Estimativa:** M · **Marco:** Produção · **Depende de:** ATT-01

- **Endpoints:** `GET /api/admin/v1/attachments/:id/content` (equipe com acesso à denúncia) e
  `GET /api/public/v1/me/attachments/:id/content` (denunciante, só anexos da própria denúncia).
- **Auditoria:** `ATTACHMENT_DOWNLOADED`; `ATTACHMENT_INTEGRITY_FAILED` se a verificação falhar.

**Critérios de aceite**

- [ ] Decifra em streaming e confere o `ciphertext_hash` e a tag GCM. Divergência: 500 genérico e auditoria.
- [ ] Cabeçalhos: `Content-Disposition: attachment` com o nome original higienizado,
      `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
- [ ] Anexo de outra denúncia: 404.

### ATT-05 · Remoção para o expurgo

**Estimativa:** P · **Marco:** Produção · **Depende de:** TRV-06

**Critérios de aceite**

- [ ] `deleteAllForReport(reportId)` apaga os objetos do storage de forma idempotente, para uso do RET-02.
