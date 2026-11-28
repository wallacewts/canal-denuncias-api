# Contrato: stores Postgres (definitivos)

Os dois stores implementam as interfaces do `@nestjs/authentication` 0.1.8 e são registrados com
`AuthenticationStorage.registerSource({ sessions, mfa })` no construtor de um provider singleton. A prova principal é
`authenticationStoreContract()` de `@nestjs/authentication/testing`, rodada contra o Postgres da suíte (com
`concurrent: true`).

## PgSessionStore (`SessionStore`)

| Método                                           | Instrução                                                                | Regra do contrato                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `getSession(id)`                                 | `SELECT … FROM sessions s JOIN users u … WHERE s.id = $1`                | devolve expiradas também (o serviço confere); `extra` = usuário e perfis |
| `createSession(record)`                          | `INSERT`                                                                 | id novo e aleatório; aproveita para apagar as expiradas do usuário       |
| `touchSession(id, at)`                           | `UPDATE … SET last_active_at = $2 WHERE id = $1 AND last_active_at < $2` | só se existir e só para frente; nunca recria sessão apagada              |
| `deleteSession(id)`                              | `DELETE … WHERE id = $1`                                                 | devolve `true` só se esta chamada apagou                                 |
| demais do contrato (listar e apagar por usuário) | uma instrução cada                                                       | conforme a interface instalada                                           |

Campos opcionais voltam ausentes (`undefined`), nunca `null`. Horários vêm do relógio do serviço, nunca do banco.

## PgMfaStore (`MfaStore`)

| Método                                    | Instrução                                                          | Regra do contrato                                      |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| `getTotp(userId)`                         | `SELECT` + abrir com `AppSecretService`                            | segredo devolvido em base32 só em memória              |
| `saveTotp(userId, record)`                | selar com `AppSecretService` **antes**; depois um `UPDATE` atômico | `null` apaga o aplicativo; nunca grava base32 em claro |
| `claimTotpStep(userId, step)`             | `UPDATE … WHERE … mfa_last_used_step < $2`                         | aceita cada passo uma vez (replay)                     |
| `saveRecoveryCodes(userId, hashes)`       | transação: `DELETE` + `INSERT`                                     | troca o lote inteiro                                   |
| `consumeRecoveryCode(userId, hash)`       | `DELETE … RETURNING`                                               | cada código vale uma vez                               |
| `countRecoveryCodes(userId)`              | `SELECT count(*)`                                                  |                                                        |
| `recordMfaFailure(userId, windowMs, now)` | CTE `INSERT` + contagem na janela                                  | uma instrução; uma rajada não ultrapassa o limite      |
| `countMfaFailures` / `clearMfaFailures`   | uma instrução cada                                                 |                                                        |

Chamada ao Vault sempre fora de transação (regra do projeto): selar antes do `UPDATE`, abrir depois do `SELECT`.
