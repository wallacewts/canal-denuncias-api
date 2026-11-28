# Contrato: meu perfil (USERS-07)

`GET /api/admin/v1/me`. Qualquer pessoa da equipe com sessão verificada (MFA concluído). Não é auditado. Conta como
uso da sessão, como qualquer requisição autenticada (o front não deve chamar só para manter a sessão viva).

Formato idêntico ao `CurrentUser` do front (`canal-denuncias-web/specs/004-backoffice-sign-in/contracts/auth-api.md`).

## Resposta 200

```text
CurrentUser = {
  id: uuid,
  name: string,
  email: string,
  roles: Role[],                     # só exibição; menu e rotas usam abilities
  mfaEnabledAt: string | null,       # ISO 8601 UTC
  passwordChangeRequired: boolean,   # password_changed_at nulo
  abilities: Ability[],              # catálogo completo do ACL-01, ordenado (research R1)
  idleExpiresAt: string,             # ISO 8601 UTC: último uso + 15 min; nunca depois do real, até 1 min antes
  absoluteExpiresAt: string          # ISO 8601 UTC: início da sessão + 8 h
}

Ability = 'users.manage' | 'categories.manage' | 'settings.sla' | 'retention.manage' | 'reports.list'
        | 'reports.read' | 'reports.triage' | 'reports.treat' | 'identity.request' | 'identity.approve'
        | 'audit.read' | 'dashboard.read'
```

Habilidade "por registro" (`reports.*`, `identity.*`, `retention.manage`) indica só que a pessoa pode exercê-la em
algum registro; cada operação continua checada no servidor.

## Erros

- 401: sem sessão, sessão expirada, sessão com MFA pendente ou pessoa não ativa.

## Exemplo (Analista)

```json
{
  "id": "0190…",
  "name": "Ana",
  "email": "ana@empresa.example",
  "roles": ["ANALYST"],
  "mfaEnabledAt": "2026-11-20T13:00:00.000Z",
  "passwordChangeRequired": false,
  "abilities": ["identity.request", "reports.list", "reports.read", "reports.treat"],
  "idleExpiresAt": "2026-11-28T12:25:00.000Z",
  "absoluteExpiresAt": "2026-11-28T20:00:00.000Z"
}
```

Compatibilidade: um código novo no catálogo é aditivo; o front ignora códigos que não conhece. Renomear ou remover
um código é mudança incompatível e exige decisão registrada.
