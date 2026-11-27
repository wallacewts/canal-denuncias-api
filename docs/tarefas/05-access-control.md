# 05 · access-control

**Objetivo:** decidir quem pode fazer o quê. RBAC pelos 5 perfis mais regras por registro (ABAC): o analista só vê o
que está atribuído a ele, ninguém com conflito de interesse vê a denúncia e o ADMIN nunca lê denúncias.

**Depende de:** AUTH-06, USERS-01.

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

- [ ] ADR com a escolha.

### ACL-01 · Matriz de permissões

**Estimativa:** M · **Marco:** MVP · **Depende de:** ACL-00

Documento e código com cada habilidade por perfil.

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

- [ ] DPO lê todas as denúncias e o conteúdo delas, sem tratar (não muda status, não atribui, não escreve
      mensagens). Decidido em 27/11/2026.
- [ ] Conflito de interesse (`report_access_blocks`) também vale para o DPO.
- [ ] Toda rota administrativa declara sua habilidade.

### ACL-02 · Política de acesso à denúncia

**Estimativa:** M · **Marco:** MVP · **Depende de:** ACL-01

**Critérios de aceite**

- [ ] `COMPLIANCE_MANAGER` acessa qualquer denúncia. `ANALYST` só se `reports.assigned_to_id` for ele.
- [ ] Registro em `report_access_blocks` para o usuário **nega sempre**, inclusive para `COMPLIANCE_MANAGER`.
- [ ] `ADMIN` e `AUDITOR` nunca acessam conteúdo.
- [ ] Denúncia expurgada (`shredded_at` preenchido) não tem conteúdo para ninguém (410 no detalhe).
- [ ] Registro de outro analista responde 404, não 403 (não revela que existe).

### ACL-03 · Filtro de listagem por política

**Estimativa:** M · **Marco:** MVP · **Depende de:** ACL-02

Listagens filtram no `WHERE`, nunca carregam tudo para filtrar depois.

- **Arquivos:** `src/modules/access-control/report-scope.ts`.

**Critérios de aceite**

- [ ] `scopeReportsFor(user, queryBuilder)` aplica atribuição e bloqueios por conflito numa só consulta.
- [ ] Teste com 3 analistas, 1 gestor com bloqueio e 10 denúncias: cada um vê exatamente o conjunto esperado.

### ACL-04 · Auditoria de acesso negado

**Estimativa:** P · **Marco:** MVP · **Depende de:** AUDIT-04

- **Auditoria:** `ACCESS_DENIED` (metadata: habilidade e tipo de recurso).

**Critérios de aceite**

- [ ] Todo 403 em rota administrativa gera registro com `result = DENIED`.
- [ ] O 404 de ACL-02 (registro de outro analista) também gera `ACCESS_DENIED`, porque para a auditoria foi uma
      tentativa negada.

### ACL-05 · Testes da matriz

**Estimativa:** M · **Marco:** MVP · **Depende de:** ACL-01, ACL-02

**Critérios de aceite**

- [ ] Teste em tabela: cada perfil × cada habilidade × (atribuída, não atribuída, com conflito).
- [ ] Teste de que nenhuma rota administrativa ficou sem declaração de permissão.
