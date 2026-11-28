# 05 · access-control

**Objetivo:** decidir quem pode fazer o quê. RBAC pelos 5 perfis mais regras por registro (ABAC): o analista só vê o
que está atribuído a ele, ninguém com conflito de interesse vê a denúncia e o ADMIN nunca lê denúncias.

**Depende de:** AUTH-06, USERS-01.

> **Feito na feature 007 (D59 a D62, `specs/007-access-control-policies/`).** Políticas reais em
> `src/modules/access-control/policies/`, alcance por registro no catálogo (`recordScope`), função de escopo única
> (`report-scope.ts`), `ReportAccessService` e teste de convenção das rotas. **Como as features de domínio usam**
> (contrato em `specs/007-access-control-policies/contracts/access-control.md`):
>
> - **Rota**: declara a habilidade — `@Can(ReportsPolicy, 'list' | 'readAny' | 'triageAny' | 'treatAny')`,
>   `@Can(IdentityRevealPolicy, 'requestAny' | 'decideAny')`, `@Can(RetentionPolicy, 'manage')`,
>   `@Can(SettingsPolicy, 'sla' | 'retention')`, `@Can(CatalogPolicy, 'manageCategories')`,
>   `@Can(DashboardPolicy, 'read')`. Sem a habilidade, 403 (e `ACCESS_DENIED` pelo assinante). Nada de
>   `@Can.Anyone()` em rota de denúncia.
> - **Denúncia por id**: `await reportAccess.resolve(user, id, 'reports.read', { content: true })` antes de qualquer
>   outra leitura (o id já validado como UUID). Fora do escopo ou inexistente: o mesmo 404, com `ACCESS_DENIED`
>   (`OUT_OF_SCOPE`/`NOT_FOUND`); expurgada no escopo: 410 `REPORT_SHREDDED`. Depois, a operação:
>   `authorization.authorize(ReportsPolicy, 'treat' | 'triage', user, facts)`,
>   `authorize(IdentityRevealPolicy, 'request' | 'decide', user, facts[, pedido])`,
>   `authorize(RetentionPolicy, 'manageReport', user, facts)` (403 para quem lê mas não pode).
> - **Listagem**: `scopeReportsFor(user, repo.createQueryBuilder('r'))` e depois os filtros e o `paginate()`; nunca
>   filtrar depois de carregar.

---

### ACL-00 · Decisão: CASL ou `@nestjs/authorization`

**Estimativa:** P · **Marco:** MVP · **Depende de:** AUTH-00

O registro de decisões previa CASL. O Nest 12 tem o pacote oficial `@nestjs/authorization`: políticas como providers
(podem injetar serviços), `@Can(Policy, 'habilidade')` nas rotas, `AuthorizationService.authorize()` nos serviços para
checar o registro e **negação por padrão**: rota sem `@Can()`, `@Can.Anyone()` ou `@Public()` responde 403, e a
inicialização lista essas rotas. Ele depende de `@nestjs/authentication`, ou de um guard próprio que preencha
`request.user` antes.

Pontos a avaliar:

- Negação por padrão é exatamente o requisito "negado por padrão" dos requisitos não funcionais.
- O CASL monta condições que podem virar filtro de consulta. Com o pacote oficial, o filtro de listagem (ACL-03)
  precisa ser escrito à parte.
- A decisão tem que ser coerente com AUTH-00.

Ler antes: `.claude/skills/nestjs-auth/references/authorization.md` e
https://docs.nestjs.com/security/authorization.md.

**Critérios de aceite**

- [x] ADR com a escolha (D54, `docs/adr/0053-autenticacao-e-autorizacao.md`).

### ACL-01 · Matriz de permissões

**Estimativa:** M · **Marco:** MVP · **Depende de:** ACL-00

Documento e código com cada habilidade por perfil.

> O catálogo de códigos `recurso.ação` já existe (D55, feature 005, `src/modules/access-control/abilities.ts`) e é o
> que o `GET /me` devolve. As políticas desta tarefa usam os mesmos códigos via `hasAbility`; o mapeamento de cada
> linha (rota, serviço ou consulta) está no ADR 0053.

- **Arquivos:** `src/modules/access-control/policies/`, matriz em `docs/adr/` ou neste arquivo.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

| Habilidade                                        | ADMIN | COMPLIANCE_MANAGER | ANALYST           | DPO | AUDITOR |
| ------------------------------------------------- | ----- | ------------------ | ----------------- | --- | ------- |
| Gerenciar usuários e categorias                   | ✅    |                    |                   |     |         |
| Alterar SLA                                       | ✅    |                    |                   |     |         |
| Alterar retenção e legal hold                     |       |                    |                   | ✅  |         |
| Listar todas as denúncias                         |       | ✅                 |                   | ✅  |         |
| Listar denúncias atribuídas a si                  |       | ✅                 | ✅                |     |         |
| Ver conteúdo da denúncia (somente leitura)        |       | ✅                 | ✅ (se atribuída) | ✅  |         |
| Triar, atribuir, priorizar, bloquear por conflito |       | ✅                 |                   |     |         |
| Mudar status, mensagens e notas                   |       | ✅                 | ✅ (se atribuída) |     |         |
| Pedir revelação de identidade                     |       | ✅                 | ✅ (se atribuída) |     |         |
| Aprovar ou rejeitar revelação                     |       |                    |                   | ✅  |         |
| Ver trilha de auditoria                           |       |                    |                   |     | ✅      |
| Ver indicadores                                   |       | ✅                 |                   | ✅  | ✅      |

**Critérios de aceite**

- [x] DPO lê todas as denúncias e o conteúdo delas, sem tratar (não muda status, não atribui, não escreve
      mensagens). Decidido em 27/11/2026.
- [x] Conflito de interesse (`report_access_blocks`) também vale para o DPO.
- [x] Toda rota administrativa declara sua habilidade.

### ACL-02 · Política de acesso à denúncia

**Estimativa:** M · **Marco:** MVP · **Depende de:** ACL-01

**Critérios de aceite**

- [x] `COMPLIANCE_MANAGER` acessa qualquer denúncia. `ANALYST` só se `reports.assigned_to_id` for ele.
- [x] Registro em `report_access_blocks` para o usuário **nega sempre**, inclusive para `COMPLIANCE_MANAGER`.
- [x] `ADMIN` e `AUDITOR` nunca acessam conteúdo.
- [x] Denúncia expurgada (`shredded_at` preenchido) não tem conteúdo para ninguém (410 no detalhe; no `resolve`, só
      para quem está no escopo, D59; a rota de detalhe em si é da REP-04).
- [x] Registro de outro analista responde 404, não 403 (não revela que existe).

### ACL-03 · Filtro de listagem por política

**Estimativa:** M · **Marco:** MVP · **Depende de:** ACL-02

Listagens filtram no `WHERE`, nunca carregam tudo para filtrar depois.

- **Arquivos:** `src/modules/access-control/report-scope.ts`.

**Critérios de aceite**

- [x] `scopeReportsFor(user, queryBuilder)` aplica atribuição e bloqueios por conflito numa só consulta.
- [x] Teste com 3 analistas, 1 gestor com bloqueio e 10 denúncias: cada um vê exatamente o conjunto esperado.

### ACL-04 · Auditoria de acesso negado

**Estimativa:** P · **Marco:** MVP · **Depende de:** AUDIT-04

- **Auditoria:** `ACCESS_DENIED` (metadata: habilidade e tipo de recurso).

**Critérios de aceite**

- [x] Todo 403 em rota administrativa gera registro com `result = DENIED`.
- [x] O 404 de ACL-02 (registro de outro analista) também gera `ACCESS_DENIED`, porque para a auditoria foi uma
      tentativa negada.

### ACL-05 · Testes da matriz

**Estimativa:** M · **Marco:** MVP · **Depende de:** ACL-01, ACL-02

**Critérios de aceite**

- [x] Teste em tabela: cada perfil × cada habilidade × (atribuída, não atribuída, com conflito).
- [x] Teste de que nenhuma rota administrativa ficou sem declaração de permissão.
