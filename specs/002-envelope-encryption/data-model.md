# Data Model: Criptografia em envelope

Nenhuma tabela, coluna ou migration nova. Esta feature define **como** as colunas cifradas que existem desde o
esqueleto são preenchidas e lidas.

## Colunas cifradas e quem as protege

| Coluna                                            | Chave                       | Contexto (AAD)                                        | Forma                    |
| ------------------------------------------------- | --------------------------- | ----------------------------------------------------- | ------------------------ |
| `reports.content_enc`                             | DEK da denúncia             | `reports.content_enc:<report.id>`                     | JSON versionado (`v: 1`) |
| `messages.body_enc`                               | DEK da denúncia             | `messages.body_enc:<message.id>`                      | texto                    |
| `internal_notes.body_enc`                         | DEK da denúncia             | `internal_notes.body_enc:<note.id>`                   | texto                    |
| `report_status_history.justification_enc`         | DEK da denúncia             | `report_status_history.justification_enc:<id>`        | texto                    |
| `report_access_blocks.reason_enc`                 | DEK da denúncia             | `report_access_blocks.reason_enc:<reportId>.<userId>` | texto                    |
| `identity_reveal_requests.justification_enc`      | DEK da denúncia             | `identity_reveal_requests.justification_enc:<id>`     | texto                    |
| `attachments.original_name_enc`                   | DEK da denúncia             | `attachments.original_name_enc:<attachment.id>`       | texto                    |
| objeto do anexo no storage                        | DEK da denúncia             | `attachments.object:<attachment.id>`                  | STREAM v1                |
| `users.mfa_secret_enc`                            | `app-kek` (direto no Vault) | `users.mfa_secret_enc:<user.id>` (`associated_data`)  | valor `vault:vN:...`     |
| `reports.wrapped_dek`                             | `report-kek` (no Vault)     | —                                                     | valor `vault:vN:...`     |
| `reporter_identities.payload_enc` e `wrapped_dek` | `identity-kek`              | definido pelo IDV-06                                  | fora desta feature (D24) |

`report_access_blocks` tem chave primária composta. O contexto usa os dois ids, separados por ponto, e o helper
valida que os dois são UUID.

## Valor cifrado (formato v1)

```text
[versão: 1 byte = 0x01][nonce: 12 bytes][ciphertext: N bytes][tag: 16 bytes]
```

- Tamanho mínimo: 29 bytes (texto em claro vazio). Valor menor, ou com versão diferente de `0x01`, gera
  `UnsupportedFormatError`.
- Detalhes em [contracts/field-format.md](./contracts/field-format.md).

## Conteúdo da denúncia (versão 1)

O tipo `ReportContentV1` já existe em `src/modules/reports/report-content.ts`. Esta feature acrescenta o schema zod
correspondente, usado na abertura:

| Campo             | Regra                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `v`               | literal `1`                                                                                |
| `description`     | texto obrigatório, com limite de tamanho                                                   |
| `occurredOn`      | opcional: data ISO ou período `AAAA-MM`                                                    |
| `location`        | texto opcional, com limite                                                                 |
| `affectedSystems` | texto opcional, com limite                                                                 |
| `dataTypes`       | lista opcional, sem repetição, de `PERSONAL`, `FINANCIAL`, `CREDENTIALS`, `OTHER` (REP-02) |
| `involved`        | lista opcional de `{ name?, role? }`                                                       |
| `howKnown`        | texto opcional, com limite                                                                 |
| `evidenceNotes`   | texto opcional, com limite                                                                 |

Objeto estrito: campo a mais faz a abertura falhar. Os limites exatos são os da feature reports (REP-01); até lá,
o schema usa os limites do backlog e eles são revistos lá.

## Chave de dados (DEK)

| Estado    | Onde está                                                        | Duração                                          |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| Protegida | `reports.wrapped_dek` (`vault:vN:...`)                           | até o expurgo                                    |
| Em claro  | `Buffer` de 32 bytes dentro de `withReportKey`/`createReportKey` | só durante a função; zerada no `finally`         |
| Destruída | `wrapped_dek = NULL` (expurgo, RET-02)                           | definitiva; abrir gera `ContentUnavailableError` |

Transição de versão: a recifragem troca `vault:vN:` por `vault:v<latest>:` sem passar pelo estado "em claro" dentro
da API (o Vault faz a troca internamente).

## Execução da recifragem

Sem tabela. O estado é o próprio prefixo de versão em `wrapped_dek`. A recifragem gera dois tipos de registro em
`audit_logs`, ambos com ator `SYSTEM` (sem usuário e sem IP), `resource_type = kek` e `resource_id = report-kek`:

| Registro          | Quando                                                    | `result`               | `metadata` (só números)                                  |
| ----------------- | --------------------------------------------------------- | ---------------------- | -------------------------------------------------------- |
| `KEYS_REWRAPPED`  | um por lote, na **mesma transação** dos `UPDATE`s do lote | `SUCCESS`              | `{ latestVersion, batch, rewrapped, skipped }`           |
| `KEYS_REWRAP_RUN` | um por execução, no fim (sucesso, erro ou interrupção)    | `SUCCESS` ou `FAILURE` | `{ latestVersion, batches, rewrapped, skipped, failed }` |

Se a transação de um lote falhar, os `UPDATE`s e o registro do lote são desfeitos juntos, e o lote entra na próxima
execução.

## Arquivo cifrado

Formato STREAM v1, detalhado em [contracts/stream-format.md](./contracts/stream-format.md). O sha256 do arquivo
cifrado vai para `attachments.ciphertext_hash` (gravado pela feature attachments).
