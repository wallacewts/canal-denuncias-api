# Contrato: rotas do Auditor

Ambas em `@AdminApi('audit-logs')`, com 401 sem identidade (R3), 403 para quem não tem o perfil `AUDITOR`, sem cache
(feature 001) e erros no formato `ApiError` da 001. Exportadas em `openapi/admin.json`.

## GET /api/admin/v1/audit-logs

Query (zod, `strictObject`): `actorUserId?` (uuid), `action?` (catálogo), `resourceType?` (catálogo), `resourceId?`
(regex fechada), `from?`/`to?` (ISO 8601, `from <= to`), `after?` (cursor opaco), `limit?` (1 a 100, padrão 50).

Resposta 200: `Page<AuditLogView>` em ordem decrescente de `id`.

```ts
interface AuditLogView {
  id: string;
  occurredAt: string;
  actorType: ActorType;
  actorUserId: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string | null;
  result: AuditResult;
  ip: string | null;
  userAgent: string | null;
  metadata: object | null;
}
```

Grava `AUDIT_LOG_VIEWED`. Filtro ou cursor inválido: 400 com mensagem fixa, sem ecoar o valor.

## POST /api/admin/v1/audit-logs/verification

Sem corpo. Resposta 200: `{ ok, checked, firstBrokenId, anchoredAt }`. Grava `AUDIT_CHAIN_VERIFIED`. Síncrona.
