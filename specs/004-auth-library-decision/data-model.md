# Data Model: Decisão das bibliotecas de autenticação e autorização

Ajustes definitivos (FR-023) nas tabelas da feature 001, para os contratos `SessionStore` e `MfaStore` do
`@nestjs/authentication` 0.1.8. As tabelas estão vazias hoje (nenhum login existiu): a migration `AuthStores` não
migra dados e tem `down()` que restaura o formato anterior.

## sessions (ajustada)

| Coluna           | Tipo                                                  | Regra                                                                             |
| ---------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `id`             | `varchar(64)` PK                                      | SHA-256 do token do cookie, gerado pelo pacote. O token nunca é guardado          |
| `user_id`        | `uuid` FK → `users` (`ON DELETE CASCADE`)             |                                                                                   |
| `created_at`     | `timestamptz`                                         | relógio do `SessionService`                                                       |
| `expires_at`     | `timestamptz`                                         | expiração absoluta (8 h após o login verificado)                                  |
| `last_active_at` | `timestamptz`                                         | inatividade (15 min); só avança: `UPDATE … WHERE id = $1 AND last_active_at < $2` |
| `mfa`            | enum `session_mfa_state` (`pending`, `verified`) null | `pending` não autentica rota (guard do pacote)                                    |
| `metadata`       | `jsonb` null                                          | só `{ ip, userAgent }` da equipe interna; nunca dado de denunciante               |

- Índice em `user_id` (listar e revogar todas as sessões do usuário) e em `expires_at` (limpeza, RET-05).
- Saem `refresh_token_hash`, `family_id`, `revoked_at` e `last_seen_at`: revogação de sessão é `DELETE` (que devolve
  se apagou, como o contrato exige). Não há renovação por tokens (R3).
- Leitura com o usuário na mesma consulta (`JOIN users`) para o `extra` do `SessionRecord`: uma leitura por
  requisição; usuário `DISABLED` não autentica.

## users (colunas de MFA)

| Coluna                   | Tipo                           | Regra                                                                                                                               |
| ------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `mfa_secret_enc`         | `bytea` null (existente)       | segredo TOTP confirmado, selado pelo `AppSecretService` (`app-kek`, AAD `users.mfa_secret_enc:<id>`)                                |
| `mfa_pending_secret_enc` | `bytea` null (novo)            | segredo em cadastro ou em troca, selado do mesmo jeito (campo novo em `ENCRYPTED_FIELDS`)                                           |
| `mfa_enabled_at`         | `timestamptz` null (existente) | não nulo = aplicativo confirmado                                                                                                    |
| `mfa_last_used_step`     | `bigint` null (novo)           | último passo de 30 s aceito; `claimTotpStep` = `UPDATE … WHERE id = $1 AND (mfa_last_used_step IS NULL OR mfa_last_used_step < $2)` |

CHECK: `mfa_enabled_at IS NULL OR mfa_secret_enc IS NOT NULL`.

## recovery_codes (ajustada)

| Coluna      | Tipo                  | Regra                                       |
| ----------- | --------------------- | ------------------------------------------- |
| `id`        | `uuid` PK (existente) |                                             |
| `user_id`   | `uuid` FK (existente) |                                             |
| `code_hash` | `varchar` (existente) | hash lento do pacote, salgado com o usuário |

- `UNIQUE (user_id, code_hash)`. Consumo: `DELETE … WHERE user_id = $1 AND code_hash = $2 RETURNING id` (uma
  instrução: o mesmo código nunca vale duas vezes). `used_at` sai (o código usado deixa de existir).
- `saveRecoveryCodes` troca o lote inteiro numa transação (apaga os antigos, insere os novos).

## mfa_failures (nova)

| Coluna      | Tipo                                      | Regra                   |
| ----------- | ----------------------------------------- | ----------------------- |
| `id`        | `bigint` identidade PK                    |                         |
| `user_id`   | `uuid` FK → `users` (`ON DELETE CASCADE`) |                         |
| `failed_at` | `timestamptz`                             | relógio do `MfaService` |

- `recordMfaFailure`: `INSERT` e contagem na janela na mesma instrução (CTE), devolvendo o número da tentativa.
- Índice `(user_id, failed_at)`. `clearMfaFailures` apaga as do usuário. Limpeza das antigas pela retenção (RET-05).

## Estados da sessão

```text
(login com senha) ──> pending ──(TOTP ou código de recuperação)──> verified ──> (15 min sem uso | 8 h | saída | revokeAll) ──> removida
        │                 └──(10 min, mfa.pendingTtl)──> removida
        └── o id é trocado em cada transição (fixação de sessão)
```
