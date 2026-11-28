# Contrato: catálogo de ações e metadata

Regras gerais de todo schema de metadata: `z.strictObject`, sem `text()` e sem `z.string()` livre. Tipos permitidos:
`uuid`, enums do domínio, inteiros não negativos, datas ISO 8601, booleanos e códigos `^[A-Z0-9_]{1,40}$`. Ação sem
metadata usa `z.strictObject({})` e aceita `undefined`.

| Ação                                    | Metadata                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `USER_CREATED`                          | `{ roles: Role[], forced: boolean }` (como hoje, feature 001)                                   |
| `USER_ROLES_CHANGED`                    | `{ before: Role[], after: Role[] }`                                                             |
| `USER_STATUS_CHANGED`                   | `{ from: UserStatus, to: UserStatus }`                                                          |
| `REPORT_STATUS_CHANGED`                 | `{ from: ReportStatus, to: ReportStatus, outcome?: ReportOutcome }`                             |
| `REPORT_PRIORITY_CHANGED`               | `{ from?: Priority, to: Priority }`                                                             |
| `REPORT_ASSIGNED` / `REPORT_UNASSIGNED` | `{ userId: uuid }`                                                                              |
| `REPORT_LIST_VIEWED`                    | `{ filters: { status?: ReportStatus, categoryId?: uuid, assignedToId?: uuid }, count: int }`    |
| `SETTING_UPDATED`                       | `{ key: chave de configuração ^[a-zA-Z0-9_.]{1,80}$ }` (nunca o valor)                          |
| `KEYS_REWRAPPED`                        | `{ latestVersion: int, batch: int, rewrapped: int, skipped: int }` (como hoje, feature 002)     |
| `KEYS_REWRAP_RUN`                       | `{ latestVersion: int, batches: int, rewrapped: int, skipped: int, failed: int }` (como hoje)   |
| `AUDIT_LOG_VIEWED`                      | `{ filters: { actorUserId?, action?, resourceType?, resourceId?, from?, to? }, count: int }`    |
| `AUDIT_CHAIN_VERIFIED`                  | `{ ok: boolean, checked: int, firstBrokenId?: código numérico, anchored: boolean }`             |
| `AUDIT_LOG_PURGED`                      | `{ partition: código, purgedThrough: data, rowsRemoved: int, anchorAuditId?: código numérico }` |
| `ACCESS_DENIED`                         | `{ required?: Role }`                                                                           |
| demais ações da AUDIT-01                | `{}` até a feature que as usa definir o formato, sempre com estas regras                        |

Os formatos definidos aqui para ações de features futuras são o ponto de partida; cada feature pode estreitar o seu,
nunca abrir para texto livre.

Tipos de recurso: `user`, `session`, `category`, `setting`, `report`, `message`, `attachment`, `identity`,
`internal_note`, `kek`, `audit_log`, `reporting`, `system`. Identificador do recurso: `^[A-Za-z0-9_.:-]{1,64}$`.
