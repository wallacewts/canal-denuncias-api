# Contrato: módulo `access-control` para as features de domínio

Esta feature não cria nem altera rota HTTP pública ou administrativa: `openapi/` não muda e o `GET /me` devolve o
mesmo catálogo (SC-007). O contrato abaixo é a interface interna que as features de domínio (REP, CASE, MSG, IDV,
RET, CAT, REPT) usam. Os nomes são do plano; a forma exata dos tipos é da implementação.

## 1. Declaração na rota

Toda rota `@AdminApi` declara uma habilidade (o teste de convenção falha sem ela):

```ts
@Can(ReportsPolicy, 'list')        // GET /reports
@Can(ReportsPolicy, 'readAny')     // GET /reports/:id
@Can(ReportsPolicy, 'triageAny')   // triagem, atribuição, prioridade, bloqueio por conflito
@Can(ReportsPolicy, 'treatAny')    // status, mensagens, notas
@Can(IdentityRevealPolicy, 'requestAny' | 'decideAny')
@Can(RetentionPolicy, 'manage')    // legal hold, prazos próximos
@Can(SettingsPolicy, 'sla' | 'retention')
@Can(CatalogPolicy, 'manageCategories')
@Can(AuditPolicy, 'read')          // trilha (migrada nesta feature)
@Can(DashboardPolicy, 'read')      // indicadores
```

Sem a habilidade: **403** e `ACCESS_DENIED` (pelo assinante, com `policy`, `ability`, `code`, `resourceType`).
`@Can.Anyone()` só nas rotas da lista do teste de convenção (próprio perfil e próprias sessões).

## 2. Listagem filtrada

```ts
scopeReportsFor(user: StaffUser, qb: SelectQueryBuilder<Report>, alias = 'r'): SelectQueryBuilder<Report>
```

- Aplica atribuição e bloqueio por conflito no `WHERE` da mesma consulta (habilidade `reports.list`).
- Pessoa sem a habilidade → condição falsa (conjunto vazio).
- Parâmetros com nome reservado (`acl_scope_*`); compatível com `paginate()` e com os filtros da listagem.

## 3. Denúncia por id

```ts
ReportAccessService.resolve(
  user: StaffUser,
  reportId: string,            // já validado como UUID (400 antes)
  ability: 'reports.read' | 'reports.triage' | 'retention.manage' | ...,
  options?: { content?: boolean }, // true: expurgada dentro do escopo → 410
): Promise<ReportAccessFacts>
```

| Situação                                  | Efeito                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| inexistente                               | `ACCESS_DENIED` (`REPORT`, `resourceId`, `code`, `reason: NOT_FOUND`) e 404 padrão |
| fora do escopo (não atribuída, bloqueada) | o mesmo registro com `reason: OUT_OF_SCOPE` e o mesmo 404                          |
| no escopo, expurgada, `content: true`     | 410 `REPORT_SHREDDED`                                                              |
| no escopo                                 | devolve `ReportAccessFacts`                                                        |

Mesma consulta e mesma escrita nos dois 404 (custo e tempo iguais; `npm run test:timing`).

## 4. Regra da operação sobre o registro

Depois do `resolve`, o serviço confere a habilidade da operação:

```ts
await authorization.authorize(ReportsPolicy, 'treat', user, facts); // 403: alcança a leitura, mas não pode tratar
await authorization.authorize(IdentityRevealPolicy, 'decide', user, facts, request); // four-eyes
```

A negação aqui é 403 com `ACCESS_DENIED` pelo assinante: quem a recebe já alcança a denúncia.

## 5. Trilha: metadata de `ACCESS_DENIED`

```text
{ policy?: string|null, ability?: string|null, code?: <código do catálogo>, reason?: 'OUT_OF_SCOPE'|'NOT_FOUND', required?: Role }
```

Só nomes de código e enums; nunca texto, valor recebido ou conteúdo de denúncia.
