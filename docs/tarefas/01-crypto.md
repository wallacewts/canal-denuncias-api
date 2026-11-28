# 01 · crypto

**Objetivo:** envelope encryption de todo dado sensível. Uma DEK por denúncia (protegida pela `report-kek`), uma DEK
para a identidade (protegida pela `identity-kek`) e cifragem direta dos segredos TOTP (`app-kek`). AES-256-GCM com
AAD.

**Depende de:** TRV-04 (cliente do Vault).

**Status:** implementado na feature 002 (`specs/002-envelope-encryption`). Diferenças em relação a este texto: a API só
usa a `report-kek` e a `app-kek`; a DEK da identidade e o rewrap da `identity-kek` ficam com o `identity-worker`
(IDV-06, D24). Os nomes finais são `DataKeyService.createReportKey`/`withReportKey`, `RecordCipher` e
`AppSecretService.seal`/`open`. O `identity-worker` usa `datakey` e `decrypt` na `identity-kek` (não `encrypt`), e a
recifragem audita por lote na mesma transação dos UPDATEs (`KEYS_REWRAPPED`) mais um resumo (`KEYS_REWRAP_RUN`).

---

### CRYPTO-01 · Formato do campo cifrado

**Estimativa:** M · **Marco:** MVP

Funções puras de cifragem e decifragem de campo.

- **Arquivos:** `src/modules/crypto/field-cipher.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] Formato `[1 byte versão][12 bytes nonce][ciphertext][16 bytes tag]` com `node:crypto` (`aes-256-gcm`).
- [x] AAD obrigatória no formato `"<tabela>.<campo>:<id do registro>"`, montada por um helper único.
- [x] Nonce aleatório por cifragem (nunca reaproveitado).
- [x] Testes: ida e volta; AAD diferente falha; byte alterado no ciphertext ou na tag falha; versão desconhecida
      falha; dois cifrados do mesmo texto são diferentes.

### CRYPTO-02 · Geração e abertura de DEK

**Estimativa:** M · **Marco:** MVP · **Depende de:** CRYPTO-01

- **Arquivos:** `src/modules/crypto/key-service.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] `createDataKey('report' | 'identity')` retorna `{ plaintext, wrapped }` via `transit/datakey/plaintext`.
- [x] `openDataKey(kind, wrapped)` decifra a DEK pelo Vault.
- [x] A DEK em claro só existe durante a operação: `withDataKey(kind, wrapped, fn)` zera o buffer no `finally`.
- [x] Sem cache de DEK em memória no MVP (decisão registrada). Medir latência e reavaliar depois.
- [x] As chamadas ao Vault acontecem antes de abrir transação no banco (regra: nada de HTTP dentro de transação).
- [x] Teste de integração contra o Vault do docker-compose.

### CRYPTO-03 · API de alto nível para registros cifrados

**Estimativa:** M · **Marco:** MVP · **Depende de:** CRYPTO-02

Serviço usado por reports, messages, case-management e identity-vault.

- **Arquivos:** `src/modules/crypto/record-cipher.service.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] `sealJson(dek, aad, objeto)` e `openJson(dek, aad, schema)`: o JSON decifrado é validado pelo schema da versão
      (ex.: `ReportContentV1`).
- [x] `sealText` e `openText` para mensagens, notas e justificativas.
- [x] IDs de registros cifrados são gerados na aplicação (UUID v7) antes do insert, porque a AAD precisa do id. O
      default `uuidv7()` do banco continua como reserva.
- [x] Testes: JSON de versão desconhecida falha; texto de uma mensagem não abre com a AAD de outra.

### CRYPTO-04 · Cifragem de arquivos em streaming

**Estimativa:** G · **Marco:** Produção · **Depende de:** CRYPTO-02

Usada por attachments.

- **Arquivos:** `src/modules/crypto/stream-cipher.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] Cifra e decifra em streaming, sem carregar o arquivo inteiro em memória. Formato documentado (cabeçalho com
      versão e nonce, tag no fim, ou blocos com tag própria).
- [x] Calcula o sha256 do arquivo cifrado durante a escrita (`attachments.ciphertext_hash`).
- [x] Decifragem falha se o arquivo for truncado ou alterado.
- [x] Teste com arquivo de 10 MB: memória estável, ida e volta íntegra.

### CRYPTO-05 · Cifragem direta com a app-kek

**Estimativa:** P · **Marco:** MVP · **Depende de:** TRV-04

- **Arquivos:** `src/modules/crypto/app-secret.service.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] `sealAppSecret` e `openAppSecret` usam `transit/encrypt/app-kek` e `transit/decrypt/app-kek` (para
      `users.mfa_secret_enc`).
- [x] Teste de integração.

### CRYPTO-06 · Rotação de KEK e rewrap

**Estimativa:** M · **Marco:** Produção · **Depende de:** CRYPTO-02, TRV-09

- **Arquivos:** `src/cli/rewrap-keys.command.ts`, `src/modules/crypto/rewrap.service.ts`.
- **Endpoints:** nenhum (comando de CLI).
- **Auditoria:** `KEYS_REWRAPPED` (`actorType = SYSTEM`, metadata: KEK e quantidade de registros).

**Critérios de aceite**

- [x] `npm run cli -- rewrap-keys --kek report-kek` percorre `reports.wrapped_dek` (e `reporter_identities` para a
      `identity-kek`) em lotes e troca cada valor pelo resultado de `transit/rewrap`.
- [x] Idempotente e retomável (pode ser interrompido e rodado de novo).
- [x] Conteúdo cifrado não é tocado.
- [x] Teste: rotacionar a chave no Vault, rodar o rewrap e abrir uma denúncia antiga.

### CRYPTO-07 · Políticas do Vault de produção

**Estimativa:** M · **Marco:** Produção

- **Arquivos:** `docs/deploy/vault/` (políticas HCL e passo a passo de inicialização, unseal por Shamir e backup).
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] Política da API com acesso mínimo: `datakey` e `decrypt` em `report-kek`, `encrypt` e `decrypt` em `app-kek`,
      `rewrap` só para o perfil de manutenção.
- [x] A API **não** tem nenhuma permissão na `identity-kek`. Só o serviço isolado de identidade (IDV-06) tem, com um
      AppRole próprio: `encrypt` para gravar a identificação e `decrypt` para a revelação. Decidido em 27/11/2026.
- [x] Audit device do próprio Vault ligado.

### CRYPTO-08 · Testes de não vazamento de segredo

**Estimativa:** P · **Marco:** MVP

**Critérios de aceite**

- [x] Erros de cifragem e do Vault nunca incluem plaintext, DEK ou ciphertext na mensagem.
- [x] Teste que força falhas (AAD errada, Vault fora do ar) e verifica a resposta e o log.
