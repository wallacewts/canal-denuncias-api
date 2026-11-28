# Data Model: Login da equipe, MFA, senha e sessões

## Migration nova `StaffSignIn` (à mão, com `down()`)

| Tabela     | Coluna                     | Tipo                          | Regra                                              |
| ---------- | -------------------------- | ----------------------------- | -------------------------------------------------- |
| `users`    | `lockout_level`            | `smallint NOT NULL DEFAULT 0` | `CHECK (lockout_level BETWEEN 0 AND 16)`           |
| `sessions` | `password_change_failures` | `smallint NOT NULL DEFAULT 0` | `CHECK (password_change_failures BETWEEN 0 AND 5)` |

Entidades (`User`, `Session`) ganham as colunas; nada mais muda no schema.

## Pessoa da equipe (`users`, existente)

| Campo                 | Uso                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------- |
| `password_hash`       | verificado sempre (hash fictício para e-mail inexistente); refeito se `needsRehash` |
| `failed_login_count`  | +1 atômico por senha errada ou código errado no desafio; zera na entrada completa   |
| `locked_until`        | `now + 15 min × 2^lockout_level` (teto 24 h) ao chegar a 5 falhas                   |
| `lockout_level`       | novo; +1 a cada bloqueio; zera na entrada completa                                  |
| `status`              | `BLOCKED`/`DISABLED` → 401 genérico                                                 |
| `password_changed_at` | nulo = troca obrigatória; preenchido na troca                                       |
| `mfa_*`               | cadastro e confirmação pelo pacote (stores da feature 004)                          |
| `last_login_at`       | já gravado pelo assinante da feature 005                                            |

## Sessão (`sessions`, existente)

| Campo                                        | Uso                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `mfa`                                        | `pending` (com autenticador, antes do desafio), `verified` ou ausente (sem MFA) |
| `metadata`                                   | IP e navegador gravados no `signIn` (já existe)                                 |
| `created_at`, `last_active_at`, `expires_at` | lista de sessões e horários de expiração                                        |
| `password_change_failures`                   | novo; contador de erros de senha atual da própria sessão (R6)                   |

## Próxima etapa (calculada, não guardada)

```text
sessão pending                         → MFA_REQUIRED
verificada + troca obrigatória         → PASSWORD_CHANGE_REQUIRED
sem MFA + troca obrigatória            → PASSWORD_CHANGE_REQUIRED
sem MFA + sem troca                    → MFA_ENROLLMENT_REQUIRED
verificada + sem troca                 → DONE
```

## Auditoria (catálogo e schemas)

| Ação                                                                           | Metadata                                                                                                        | Mudança           |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------- |
| `AUTH_LOGIN_FAILED`                                                            | `{ reason: UNKNOWN_ACCOUNT \| BAD_CREDENTIALS \| TEMPORARILY_LOCKED \| BLOCKED \| DISABLED, locked?: boolean }` | schema novo       |
| `AUTH_MFA_ENROLLED`                                                            | `{ replaced: boolean }`                                                                                         | schema novo       |
| `AUTH_RECOVERY_CODE_USED`                                                      | sem metadata                                                                                                    | mapeado do evento |
| `AUTH_PASSWORD_CHANGED`                                                        | sem metadata                                                                                                    | —                 |
| `AUTH_PASSWORD_CHANGE_FAILED`                                                  | `{ reason: CURRENT_PASSWORD_INVALID, attempt: 1..5, locked: boolean }`                                          | ação nova         |
| `AUTH_SIGNED_IN`, `AUTH_MFA_FAILED`, `AUTH_SIGNED_OUT`, `AUTH_SESSION_REVOKED` | já existem (feature 004)                                                                                        | —                 |

Recurso: `SESSION` (entrada, saída, sessões) ou `USER` (cadastro do MFA, troca de senha, falha de entrada com conta
conhecida; `resourceId` nulo para conta desconhecida). Nunca e-mail, senha, código, segredo ou id de sessão.

## Redis (limite de tentativas)

Chaves `throttle:<rota>:ip:<ip>` e `throttle:<rota>:acct:<hmac>` com expiração igual à janela; nenhum e-mail em claro.
