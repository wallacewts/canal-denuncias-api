# Data Model: Gestão da equipe interna e meu perfil

**Nenhuma migration nova.** As tabelas já existem (features 001 e 004); esta feature só lê e altera colunas
existentes.

## Usuário (`users`, existente)

| Campo                                                            | Uso nesta feature                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `id`                                                             | UUID v7, no caminho das rotas por id                                                  |
| `name`                                                           | 1 a 120 caracteres, texto livre validado (`text({ max: 120 })`); alterável            |
| `email`                                                          | `citext` único (constraint); normalizado (sem espaços nas pontas); não alterável aqui |
| `password_hash`                                                  | só escrito no cadastro (hash da senha provisória); nunca lido por estas rotas         |
| `mfa_secret_enc`, `mfa_pending_secret_enc`, `mfa_last_used_step` | apagados no reset; nunca lidos nem devolvidos                                         |
| `mfa_enabled_at`                                                 | devolvido como `mfaEnabledAt` (perfil) e `mfaEnabled` (listagem); apagado no reset    |
| `status`                                                         | `ACTIVE`, `BLOCKED`, `DISABLED` (enum `user_status`)                                  |
| `password_changed_at`                                            | nulo no cadastro = troca obrigatória (`passwordChangeRequired`)                       |
| `last_login_at`                                                  | gravado na entrada completa (R9)                                                      |
| `failed_login_count`, `locked_until`                             | não tocados (bloqueio progressivo é do AUTH-01)                                       |
| `created_at`, `updated_at`                                       | devolvidos                                                                            |

### Transições de status

```text
ACTIVE ──bloquear──▶ BLOCKED ──reativar──▶ ACTIVE
ACTIVE ──desativar─▶ DISABLED ─reativar──▶ ACTIVE
BLOCKED ─desativar─▶ DISABLED ─bloquear──▶ BLOCKED
```

- Sair de `ACTIVE` (ou ir para `DISABLED`/`BLOCKED`): sessões revogadas depois do commit (R2).
- Voltar para `ACTIVE`: sessões revogadas antes (nenhuma antiga volta).
- Ir para `DISABLED`: recusado (409 `USER_HAS_ASSIGNED_REPORTS`) com denúncias abertas atribuídas (R4).
- Tirar o último Administrador ativo de `ACTIVE`: recusado (409 `LAST_ACTIVE_ADMIN`) (R3).
- Mesmo status: sem efeito, sem registro, 200.
- Ninguém muda o próprio status (403).

## Perfil (`user_roles`, existente)

- Conjunto de 1 a 5 perfis distintos entre `ADMIN`, `COMPLIANCE_MANAGER`, `ANALYST`, `DPO`, `AUDITOR`.
- Troca do conjunto inteiro (`PUT`), na transação com o registro `USER_ROLES_CHANGED`.
- Retirar `ADMIN` do último Administrador ativo: 409 `LAST_ACTIVE_ADMIN`.
- Retirar `ANALYST` de quem tem denúncias abertas atribuídas: 409 `USER_HAS_ASSIGNED_REPORTS`.
- Ninguém troca os próprios perfis (403).

## Códigos de recuperação (`recovery_codes`, existente)

Apagados no reset do MFA, na mesma transação.

## Sessões (`sessions`, existente)

Lidas para os horários de expiração do `/me` (`last_active_at`, `expires_at`); apagadas pelo `revokeAll` do pacote.

## Denúncias (`reports`, existente)

Só lidas: contagem das abertas atribuídas a uma pessoa (`assigned_to_id`, `status`), usando o índice
`(status, assigned_to_id)` que já existe.

## Habilidade (catálogo em código, sem tabela)

Código `recurso.ação`, perfis que a concedem e escopo (global ou por registro). Catálogo em `research.md` (R1).
Calculada a cada consulta a partir dos perfis atuais.

## Auditoria (catálogo existente; schemas ajustados)

| Ação                  | Metadata                              | Mudança                                             |
| --------------------- | ------------------------------------- | --------------------------------------------------- |
| `USER_CREATED`        | `{ roles: Role[], forced?: boolean }` | `forced` passa a opcional (só o `create-admin` usa) |
| `USER_UPDATED`        | `{ fields: ['name'] }`                | schema novo; nunca o valor                          |
| `USER_STATUS_CHANGED` | `{ from, to }`                        | já existe                                           |
| `USER_ROLES_CHANGED`  | `{ before: Role[], after: Role[] }`   | já existe                                           |
| `USER_MFA_RESET`      | sem metadata                          | já existe                                           |
| `ACCESS_DENIED`       | `{ policy, ability }`                 | já existe (assinante da feature 004)                |

Recurso: `AuditResourceType.USER` com o id da pessoa alvo. Ator: o Administrador da sessão (contexto).
