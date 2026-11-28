# Contrato: rotas de equipe (USERS-02 a USERS-06)

Prefixo `/api/admin/v1`. Todas exigem sessão com MFA verificado (401 sem ela, D47/D53) e a habilidade `users.manage`
(só `ADMIN`; outro perfil → 403 registrado como `ACCESS_DENIED`). Corpo validado com rejeição de campos extras (400).
Erros no formato `ApiError` com os campos opcionais novos `code` e `details` (research R8).

## Tipos

```text
Role        = 'ADMIN' | 'COMPLIANCE_MANAGER' | 'ANALYST' | 'DPO' | 'AUDITOR'
UserStatus  = 'ACTIVE' | 'BLOCKED' | 'DISABLED'
StaffUser   = { id: uuid, name: string, email: string, roles: Role[], status: UserStatus,
                mfaEnabled: boolean, passwordChangeRequired: boolean, lastLoginAt: string | null,
                createdAt: string, updatedAt: string }            # datas ISO 8601 UTC
Page<T>     = { items: T[], nextCursor: string | null }           # paginação existente (cursor)
```

Nunca aparecem: hash de senha, segredo de MFA, códigos de recuperação.

## Rotas

| Método e caminho            | Corpo / query                                       | Sucesso                                      | Erros específicos                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /users`               | `{ name (1–120), email (≤254), roles: Role[1..5] }` | 201 `{ user: StaffUser, temporaryPassword }` | 409 `EMAIL_ALREADY_REGISTERED`                                                                                                                                                      |
| `GET /users`                | `?status=&role=&after=&limit=` (limit 1–100)        | 200 `Page<StaffUser>`, ordem por criação     | 400 cursor inválido                                                                                                                                                                 |
| `GET /users/:id`            | —                                                   | 200 `StaffUser`                              | 404                                                                                                                                                                                 |
| `PATCH /users/:id`          | `{ name }`                                          | 200 `StaffUser`                              | 404                                                                                                                                                                                 |
| `PUT /users/:id/status`     | `{ status: UserStatus }`                            | 200 `StaffUser`                              | 403 alvo = si mesmo ou quem age deixou de ser Administrador ativo; 404; 409 `LAST_ACTIVE_ADMIN`; 409 `USER_HAS_ASSIGNED_REPORTS` + `details.assignedReports` (só para `DISABLED`)   |
| `PUT /users/:id/roles`      | `{ roles: Role[1..5] }`                             | 200 `StaffUser`                              | 403 alvo = si mesmo ou quem age deixou de ser Administrador ativo; 404; 409 `LAST_ACTIVE_ADMIN`; 409 `USER_HAS_ASSIGNED_REPORTS` + `details.assignedReports` (ao retirar `ANALYST`) |
| `POST /users/:id/mfa-reset` | —                                                   | 204                                          | 403 alvo = si mesmo ou quem age deixou de ser Administrador ativo; 404                                                                                                              |

Regras:

- `temporaryPassword`: 20 caracteres aleatórios, só nesta resposta; nunca em log, auditoria ou erro.
- `PUT /users/:id/status` com o status atual: 200 sem efeito e sem registro.
- Bloquear (`BLOCKED`) é sempre permitido (exceto contra si mesmo e contra o último Administrador ativo) e não olha
  atribuições.
- Sair de `ACTIVE` revoga as sessões da pessoa; a requisição seguinte dela recebe 401.
- `PUT /users/:id/roles` com o mesmo conjunto: 200 sem efeito e sem registro.

## Exemplo de erro 409

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "A pessoa tem denúncias atribuídas. Peça ao Gestor para reatribuí-las.",
  "code": "USER_HAS_ASSIGNED_REPORTS",
  "details": { "assignedReports": 3 },
  "requestId": "…"
}
```
