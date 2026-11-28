# Contrato: módulo de auditoria (uso interno pelos outros módulos)

## AuditService.record(entry, manager?)

```ts
interface AuditEntry<A extends AuditAction> {
  action: A;                            // do catálogo; ação fora dele não compila e é recusada em runtime
  resourceType: AuditResourceType;
  resourceId?: string | null;           // até 64 caracteres, regex fechada
  result: AuditResult;                  // SUCCESS | DENIED | FAILURE
  metadata?: AuditMetadata<A>;          // validada pelo schema da ação
}
record<A extends AuditAction>(entry: AuditEntry<A>, manager?: EntityManager): Promise<AuditLog>;
```

- **Não aceita** `actorType`, `actorUserId`, `ip` nem `userAgent`: vêm do `AuditContext` (FR-012).
- Valida a metadata **antes** de abrir a transação. Erros:
  - `AuditMetadataRejected` (mensagem fixa: "Metadados de auditoria inválidos."; só códigos e caminhos das issues;
    sem `cause`);
  - `AuditActorUndetermined` (mensagem fixa: "Ator da auditoria indeterminado."), fora de contexto.
- Com `manager`, grava na transação do chamador (sem mudança em relação à 001).

## AuditContext

- `runAsSystem<T>(fn: () => Promise<T>): Promise<T>`: jobs e comandos.
- O contexto de rota é aberto por `AuditContextInterceptor` (global), pela área do controller.
- `current(): ActorContext | null` só para o `AuditService` e testes.

## @Audited(action, resourceType, resolveId?)

- `resolveId(params, query) => string | null`; nunca recebe corpo nem resposta.
- Resultado: `SUCCESS` no fim do handler; `DENIED` com `ForbiddenException`; `FAILURE` com qualquer outro erro (o erro
  original é relançado e tratado pelo filtro da 001).
- Se a gravação de um `SUCCESS` falhar, a resposta vira 500 genérico.

## Porta de identidade (AUTH_IDENTITY)

```ts
interface AuthIdentity {
  resolve(request: Request): Promise<{ userId: string; roles: Role[] } | null>;
}
```

Padrão: devolve `null` (tudo em `/api/admin` → 401). Implementação real: AUTH-06. Implementação de teste:
`test/support/fake-identity.ts`, nunca importada por `src/` (teste de convenção).
