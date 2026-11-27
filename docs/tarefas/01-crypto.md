# 01 · crypto

**Objetivo:** envelope encryption de todo dado sensível. Uma DEK por denúncia (protegida pela `report-kek`), uma DEK
para a identidade (protegida pela `identity-kek`) e cifragem direta dos segredos TOTP (`app-kek`). AES-256-GCM com
AAD.

**Depende de:** TRV-04 (cliente do Vault).

---

### CRYPTO-01 · Formato do campo cifrado

**Estimativa:** M · **Marco:** MVP

Funções puras de cifragem e decifragem de campo.

- **Arquivos:** `src/modules/crypto/field-cipher.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [ ] Formato `[1 byte versão][12 bytes nonce][ciphertext][16 bytes tag]` com `node:crypto` (`aes-256-gcm`).
- [ ] AAD obrigatória no formato `"<tabela>.<campo>:<id do registro>"`, montada por um helper único.
- [ ] Nonce aleatório por cifragem (nunca reaproveitado).
- [ ] Testes: ida e volta; AAD diferente falha; byte alterado no ciphertext ou na tag falha; versão desconhecida
      falha; dois cifrados do mesmo texto são diferentes.

### CRYPTO-02 · Geração e abertura de DEK

**Estimativa:** M · **Marco:** MVP · **Depende de:** CRYPTO-01

- **Arquivos:** `src/modules/crypto/key-service.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [ ] `createDataKey('report' | 'identity')` retorna `{ plaintext, wrapped }` via `transit/datakey/plaintext`.
- [ ] `openDataKey(kind, wrapped)` decifra a DEK pelo Vault.
- [ ] A DEK em claro só existe durante a operação: `withDataKey(kind, wrapped, fn)` zera o buffer no `finally`.
- [ ] Sem cache de DEK em memória no MVP (decisão registrada). Medir latência e reavaliar depois.
- [ ] As chamadas ao Vault acontecem antes de abrir transação no banco (regra: nada de HTTP dentro de transação).
- [ ] Teste de integração contra o Vault do docker-compose.

### CRYPTO-03 · API de alto nível para registros cifrados

**Estimativa:** M · **Marco:** MVP · **Depende de:** CRYPTO-02

Serviço usado por reports, messages, case-management e identity-vault.

- **Arquivos:** `src/modules/crypto/record-cipher.service.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [ ] `sealJson(dek, aad, objeto)` e `openJson(dek, aad, schema)`: o JSON decifrado é validado pelo schema da versão
      (ex.: `ReportContentV1`).
- [ ] `sealText` e `openText` para mensagens, notas e justificativas.
- [ ] IDs de registros cifrados são gerados na aplicação (UUID v7) antes do insert, porque a AAD precisa do id. O
      default `uuidv7()` do banco continua como reserva.
- [ ] Testes: JSON de versão desconhecida falha; texto de uma mensagem não abre com a AAD de outra.

### CRYPTO-04 · Cifragem de arquivos em streaming

**Estimativa:** G · **Marco:** Produção · **Depende de:** CRYPTO-02

Usada por attachments.

- **Arquivos:** `src/modules/crypto/stream-cipher.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [ ] Cifra e decifra em streaming, sem carregar o arquivo inteiro em memória. Formato documentado (cabeçalho com
      versão e nonce, tag no fim, ou blocos com tag própria).
- [ ] Calcula o sha256 do arquivo cifrado durante a escrita (`attachments.ciphertext_hash`).
- [ ] Decifragem falha se o arquivo for truncado ou alterado.
- [ ] Teste com arquivo de 10 MB: memória estável, ida e volta íntegra.

### CRYPTO-05 · Cifragem direta com a app-kek

**Estimativa:** P · **Marco:** MVP · **Depende de:** TRV-04

- **Arquivos:** `src/modules/crypto/app-secret.service.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [ ] `sealAppSecret` e `openAppSecret` usam `transit/encrypt/app-kek` e `transit/decrypt/app-kek` (para
      `users.mfa_secret_enc`).
- [ ] Teste de integração.

### CRYPTO-06 · Rotação de KEK e rewrap

**Estimativa:** M · **Marco:** Produção · **Depende de:** CRYPTO-02, TRV-09

- **Arquivos:** `src/cli/rewrap-keys.command.ts`, `src/modules/crypto/rewrap.service.ts`.
- **Endpoints:** nenhum (comando de CLI).
- **Auditoria:** `KEYS_REWRAPPED` (`actorType = SYSTEM`, metadata: KEK e quantidade de registros).

**Critérios de aceite**

- [ ] `npm run cli -- rewrap-keys --kek report-kek` percorre `reports.wrapped_dek` (e `reporter_identities` para a
      `identity-kek`) em lotes e troca cada valor pelo resultado de `transit/rewrap`.
- [ ] Idempotente e retomável (pode ser interrompido e rodado de novo).
- [ ] Conteúdo cifrado não é tocado.
- [ ] Teste: rotacionar a chave no Vault, rodar o rewrap e abrir uma denúncia antiga.

### CRYPTO-07 · Políticas do Vault de produção

**Estimativa:** M · **Marco:** Produção

- **Arquivos:** `docs/deploy/vault/` (políticas HCL e passo a passo de inicialização, unseal por Shamir e backup).
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [ ] Política da API com acesso mínimo: `datakey` e `decrypt` em `report-kek`, `encrypt` e `decrypt` em `app-kek`,
      `rewrap` só para o perfil de manutenção.
- [ ] A API **não** tem nenhuma permissão na `identity-kek`. Só o serviço isolado de identidade (IDV-06) tem, com um
      AppRole próprio: `encrypt` para gravar a identificação e `decrypt` para a revelação. Decidido em 27/11/2026.
- [ ] Audit device do próprio Vault ligado.

### CRYPTO-08 · Testes de não vazamento de segredo

**Estimativa:** P · **Marco:** MVP

**Critérios de aceite**

- [ ] Erros de cifragem e do Vault nunca incluem plaintext, DEK ou ciphertext na mensagem.
- [ ] Teste que força falhas (AAD errada, Vault fora do ar) e verifica a resposta e o log.
