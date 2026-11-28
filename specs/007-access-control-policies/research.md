# Research: Controle de acesso — políticas reais da matriz de permissões

Decisões técnicas da feature 007, conferidas no pacote instalado (`@nestjs/authorization` 0.1.4: `Can`, `Policy`,
`AuthorizationService.can/authorize`, `AuthorizationEvents`, `PolicyRegistry.verifyCanUsage`), no código das
features 003 a 006 e no schema inicial (`reports`, `report_access_blocks`, `identity_reveal_requests`), em
2026-11-28. As decisões novas viram D59 a D62 no `docs/adr/README.md` na primeira tarefa (conferir antes o último
número do arquivo, hoje D58).

## R1. Onde fica o escopo e como leitura por registro e listagem usam a mesma regra

**Decision**: o escopo é **declarado uma vez, no catálogo**, e interpretado por **uma função**, em
`src/modules/access-control/report-scope.ts`:

1. O catálogo (`abilities.ts`) ganha, de forma aditiva e só nas habilidades por registro, o alcance de cada perfil:
   `recordScope: { [perfil]: 'all' | 'assigned' }`. Valores (da matriz do ACL-01):

   | Habilidade         | Gestor | Analista | DPO |
   | ------------------ | ------ | -------- | --- |
   | `reports.list`     | all    | assigned | all |
   | `reports.read`     | all    | assigned | all |
   | `reports.triage`   | all    | —        | —   |
   | `reports.treat`    | all    | assigned | —   |
   | `identity.request` | all    | assigned | —   |
   | `identity.approve` | —      | —        | all |
   | `retention.manage` | —      | —        | all |

   Os códigos, os perfis e o `GET /me` não mudam (SC-007): o `GET /me` devolve só códigos.

2. `reportScope(user, ability)` devolve um descritor `{ kind: 'all' | 'assigned' | 'none', userId }`: a união do
   alcance dos perfis da pessoa (`all` vence `assigned`; nenhum perfil com a habilidade → `none`). Bloqueio por
   conflito é sempre excluído, em qualquer `kind`. É o único lugar que liga perfil a alcance; as políticas só
   consultam `reportScope`/`hasAbility` (regra do AGENTS.md).
3. Dois intérpretes do **mesmo descritor**, no mesmo arquivo:
   - `scopeReportsFor(user, qb, alias = 'r')` (nome do ACL-03): aplica em um `SelectQueryBuilder` a condição no
     `WHERE` (`NOT EXISTS` em `report_access_blocks` para a pessoa; `assigned_to_id = :id` quando `assigned`;
     `FALSE` quando `none`), com parâmetros de nome reservado (`acl_scope_user`) para não colidir com filtros da
     listagem. Usa `reports.list`.
   - `allowsReport(scope, facts)`: decide em memória sobre os fatos de um registro (`assignedToId`,
     `blockedForUser`), carregados por `ReportAccessService` (R2).
4. A concordância é **provada**, não presumida: teste e2e exaustivo no banco real (perfis isolados e combinados,
   denúncias com e sem atribuição, bloqueios gerados de forma determinística): para toda pessoa e denúncia,
   "aparece em `scopeReportsFor`" ⇔ `allowsReport(reportScope(user, 'reports.read'), facts)`. Mais o cenário fixo do
   ACL-03 (3 analistas, 1 gestora com bloqueio, 1 DPO com bloqueio, 10 denúncias) com o conjunto esperado escrito à
   mão.
5. A matriz humana continua sendo a de `docs/tarefas/05-access-control.md` (o `abilities.spec.ts` já a lê); o teste
   passa a conferir também que as células "(se atribuída)" correspondem a `assigned` e os ✅ simples a `all`
   (FR-002). O mapeamento por camada fica no ADR 0053, atualizado (R5).

**Rationale**: uma só declaração (catálogo) e uma só função de escopo; os dois intérpretes são pequenos e a prova
exaustiva no Postgres pega qualquer divergência. Mantém o padrão já decidido na D54/R6 da feature 004.

**Alternatives considered**:

- **Decidir também o registro por SQL** (coluna `in_scope` calculada com a mesma condição): uma única expressão, mas
  a política deixaria de ser avaliável sem banco e o `authorize()` do pacote viraria só um repasse de booleano; a
  prova exaustiva já garante a igualdade.
- **Alcance escrito nas políticas por perfil** (como a `ExamplePolicy`): viola "políticas consultam a habilidade,
  nunca o perfil" e espalha a regra.
- **Novos códigos `reports.read-all`/`reports.read-assigned`**: mudaria o catálogo do front sem necessidade.

## R2. Negação-como-404 com o mesmo custo e tempo (Q1 = B, Q2 = B)

**Decision**: um único ponto, `ReportAccessService.resolve(user, reportId, ability)` em
`src/modules/access-control/report-access.service.ts`, usado por toda rota de denúncia por id nas features de
domínio:

1. **Uma consulta, sempre a mesma**, exista ou não a denúncia:
   `FROM (VALUES ($1::uuid)) q(id) LEFT JOIN reports r ON r.id = q.id LEFT JOIN report_access_blocks b ON
b.report_id = q.id AND b.user_id = $2`, devolvendo `exists`, `assigned_to_id`, `blocked_for_user`,
   `shredded_at`. O plano é o mesmo nos dois casos (busca por chave primária e por chave composta).
2. Decide com `allowsReport(reportScope(user, ability), facts)` (R1). Fora do escopo **ou** inexistente →
   **uma escrita igual**: `AuditService.record({ action: ACCESS_DENIED, resourceType: REPORT, resourceId: reportId,
result: DENIED, metadata: { code: ability, reason: 'OUT_OF_SCOPE' | 'NOT_FOUND' } })`, e então a mesma
   `NotFoundException` (corpo idêntico ao 404 padrão). Só o valor do enum muda entre os dois casos.
3. Dentro do escopo e expurgada (`shredded_at` preenchido) → 410 `REPORT_SHREDDED` (D56) só quando a habilidade pede
   conteúdo; o escopo vem antes (Q1 = B).
4. Dentro do escopo → devolve os fatos para o serviço chamar `authorize()` na habilidade da operação (por exemplo,
   `treat` depois de `read`); essa negação é 403, porque quem a recebe já alcança a denúncia e não aprende nada novo.
5. **Teste de tempo isolado**, no mesmo molde do SC-002 da feature 006: `test/access-control/report-not-found.timing-spec.ts`,
   rodado por `npm run test:timing` (já inclui `**/*.timing-spec.ts`, um arquivo por vez). Rota só de teste
   (`test/support/fixtures/report-access-fixture.module.ts`) que chama `resolve`; 40 amostras alternadas de
   "existe fora do escopo" e "id inexistente"; critério: diferença das medianas menor que 10% da menor mediana,
   com piso de 1 ms (sem scrypt, o tempo total é dominado pela consulta e pelo registro na trilha).

**Rationale**: o tempo vem do que é executado; com a mesma consulta e a mesma escrita (inclusive o advisory lock da
trilha), não há o que medir além de ruído. O teste existe para pegar quem um dia adicionar um atalho
(`if (!exists) throw` antes de auditar).

**Alternatives considered**: espera artificial para igualar (frágil, mais código); gravar só quando existe (Q2 = A,
rejeitada pelo usuário); 404 respondido pelo guard (o guard roda antes dos pipes e não tem o registro).

## R3. Habilidade e tipo de recurso no `ACCESS_DENIED` (FR-017)

O evento de negação do pacote traz `policy` (nome da classe) e `ability` (nome do **método**), não o código do
catálogo, e o assinante grava hoje `resourceType = SYSTEM`.

**Decision**:

- Cada política declara, num registro em `src/modules/access-control/policy-abilities.ts`, o tipo de recurso e o
  código do catálogo de cada método: `{ UsersPolicy: { resourceType: USER, abilities: { manage: 'users.manage',
actOnOther: 'users.manage' } }, ReportsPolicy: {...}, ... }`, tipado para que todo método seja um `Ability`.
- O `AuthAuditSubscriber` passa a gravar `metadata: { policy, ability, code }` e o `resourceType` do registro
  (`SYSTEM` só para rota sem declaração, `policy = null`). O id do registro não vem do guard: os argumentos do
  `@Can()` são lidos antes da validação.
- Schema de `ACCESS_DENIED` (`audit-metadata.schemas.ts`): ganha `code` (enum dos códigos do catálogo) e `reason`
  (`OUT_OF_SCOPE`, `NOT_FOUND`), ambos opcionais. `required` continua opcional no schema: a rota da trilha deixa de
  gravá-lo (passa a usar a política, R6), mas a reconferência de quem age dentro da transação dos usuários
  (`users.service.ts`, feature 005) continua gravando `required: ADMIN` e passa a gravar também
  `code: 'users.manage'`.
- Teste unitário: todo método de toda política registrada tem entrada no mapa (falha ao criar método sem código).

**Rationale**: os nomes dos métodos continuam legíveis e estáveis (a `UsersPolicy` não muda de interface) e a trilha
ganha o código que o Auditor reconhece no catálogo.

**Alternatives considered**: métodos com o próprio código como nome (`'reports.read'(user)`): o pacote aceita, mas o
`actOnOther` dos usuários não é um código, e os nomes com ponto pioram a leitura do `@Can()`.

## R4. Teste de convenção do ACL-05: como descobre as rotas

**Decision**: `test/conventions/admin-routes.e2e-spec.ts`, sobre o app completo (`createTestApp()` com os módulos de
`AppModule`, sem fixtures):

1. Percorre os controllers pelo `DiscoveryService` e o `MetadataScanner` do `@nestjs/core`, filtra os de
   `API_AREA_METADATA = 'admin'` (`@AdminApi`) e lista cada handler com método e caminho.
2. Para cada handler, lê pelo `Reflector` (método vence classe) as marcas do pacote — `authorization:can`,
   `authorization:can-anyone` — e as do projeto — `canal:admin-open` (`OpenAdminRoute`), `canal:step-route`
   (`StepRoute`). As chaves do pacote não são exportadas: um teste de sentinela aplica `@Can()` e `@Can.Anyone()` a
   uma classe de teste e confere que essas chaves aparecem (quebra na atualização do pacote, em vez de passar em
   branco).
3. Regra: todo handler tem `@Can()` com uma política registrada no mapa da R3, **ou** é aberta pelo login
   (`OpenAdminRoute`/`StepRoute`), **ou** tem `@Can.Anyone()` e está numa lista explícita do teste, com o motivo ao
   lado (hoje: `GET /me` e as rotas de `me-security`, que agem só sobre a própria pessoa).
4. Segundo sinal, independente: o app é iniciado com um logger de captura e o teste falha se o pacote registrar
   "denies every call to ... declare no check" (lista que o próprio `verifyCanUsage` produz).
5. Caso negativo provado com um controller de teste sem declaração (o teste o encontra e nomeia).

**Rationale**: o `route-walk` da feature 006 usa o `openapi/admin.json`, que não carrega as declarações de
permissão; o `DiscoveryService` vê exatamente o que está registrado no app.

**Alternatives considered**: só o log do pacote (não vê `@Can.Anyone()` fora da lista); varrer o código-fonte com
regex (frágil a formatação e a decoradores compostos).

## R5. Declaração nas rotas de denúncia e mudança no mapeamento do ADR 0053

**Decision**: com a premissa aceita (403 para quem não tem nenhuma habilidade de leitura), as rotas por registro
declaram a habilidade **na rota** e o escopo fica no serviço:

| Linha da matriz                      | Rota                                       | Serviço                                                |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------------ |
| Ver conteúdo (somente leitura)       | `@Can(ReportsPolicy, 'readAny')` → 403     | `resolve(user, id, 'reports.read')` → 404/410          |
| Triar, atribuir, priorizar, bloquear | `@Can(ReportsPolicy, 'triageAny')`         | `resolve(..., 'reports.triage')` → 404                 |
| Mudar status, mensagens e notas      | `@Can(ReportsPolicy, 'treatAny')`          | `resolve(..., 'reports.read')` + `authorize('treat')`  |
| Pedir revelação                      | `@Can(IdentityRevealPolicy, 'requestAny')` | igual a tratar                                         |
| Aprovar ou rejeitar revelação        | `@Can(IdentityRevealPolicy, 'decideAny')`  | `resolve` + `authorize('decide', request)` (four-eyes) |
| Alterar retenção e legal hold        | `@Can(RetentionPolicy, 'manage')`          | `resolve(..., 'retention.manage')` quando de denúncia  |

O DPO que tenta tratar recebe 403 na rota (não tem `reports.treat`); o analista que tenta tratar denúncia de outro
recebe 404 (não alcança a leitura). `@Can.Anyone()` deixa de ser usado em rotas de denúncia. Na primeira tarefa, o
ADR 0053 é ajustado: a frase "Denúncia expurgada responde 410 antes da política" vira "o escopo vem antes; 410 só
dentro do escopo (D59)" e a coluna "Rota" da tabela passa a mostrar as declarações acima.

**Rationale**: o guard nega cedo quem não tem a habilidade (sem tocar no banco) e o serviço esconde só o que precisa
ser escondido. Menos rotas abertas = teste de convenção mais estrito.

## R6. Políticas e onde ficam

**Decision**: em `src/modules/access-control/policies/`, uma por recurso, todas consultando só `hasAbility`,
`reportScope` e `allowsReport`:

- `UsersPolicy` (existente, sem mudança de interface);
- `ReportsPolicy`: `list`, `readAny`, `triageAny`, `treatAny` (rota) e `read`, `triage`, `treat` (registro, com
  os fatos da R2);
- `IdentityRevealPolicy`: `requestAny`, `decideAny`, `request(user, facts)`, `decide(user, facts, request)` com
  `request.requestedById !== user.id`;
- `RetentionPolicy`: `manage(user)` (parâmetro de prazo e rota) e `manageReport(user, facts)` (legal hold);
- `CatalogPolicy`: `manageCategories`; `SettingsPolicy`: `sla`, `retention`;
- `AuditPolicy`: `read`; `DashboardPolicy`: `read`.

Todas registradas no `AccessControlModule`, que passa a exportar também o `ReportAccessService`. A rota da trilha
(`audit.controller.ts`) troca `@Can.Anyone()` + `assertAuditor` por `@Can(AuditPolicy, 'read')`; o 403 e o
`ACCESS_DENIED` continuam, agora pelo assinante.

**Rationale**: políticas pequenas por recurso, como a `UsersPolicy`; as features de domínio só importam o
`AccessControlModule`.

## R7. Destino do exemplo de `test/contract/auth/example/`

**Decision**: remover `report-scope.ts` e `report-scope.e2e-spec.ts` do exemplo (substituídos pela função real e pela
prova exaustiva da R1); `ExamplePolicy` e `ExampleReportRepository` passam a usar o `report-scope.ts` real, para que
as suítes de contrato do pacote (`authorization.e2e-spec.ts`, `session-expiry.e2e-spec.ts`) continuem verdes sem
duas definições de escopo no repositório. `auth-helpers.ts`, `example-admin.controller.ts` e `example.module.ts`
ficam (são usados por várias suítes da 004 a 006).

**Rationale**: duas funções de escopo são exatamente o risco que o princípio IV quer evitar; o restante do exemplo
prova o pacote, não a matriz.

**Alternatives considered**: manter o exemplo congelado (duas regras divergindo com o tempo); apagar tudo (obrigaria
reescrever as suítes de contrato do pacote e os helpers de sessão).

## R8. Testes da matriz (ACL-05) e base de dados de teste

**Decision**:

- Unitário em tabela (`src/modules/access-control/policies/matrix.spec.ts`): perfis isolados e combinações
  (`ADMIN+ANALYST`, `DPO+ANALYST`, `COMPLIANCE_MANAGER+DPO`, `ADMIN+AUDITOR`) × cada método de política × situações
  (atribuída à pessoa, atribuída a outro, sem atribuição, com conflito, pedido de revelação feito pela própria
  pessoa), esperado derivado da matriz do `docs/tarefas/05` e do `recordScope` (180 casos só nos perfis isolados,
  SC-001).
- E2e no Postgres real (`test/access-control/`): escopo exaustivo e cenário do ACL-03 (R1), `resolve` com 404/410 e
  `ACCESS_DENIED` (R2), rota da trilha migrada, convenção (R4), tempo (R2, `timing-spec`). Denúncias criadas por
  `INSERT` mínimo em `reports` (como o exemplo já faz), sem cifragem: as regras não leem conteúdo.
- Escritos antes da implementação e falhando primeiro (princípio VII).

## R9. Sem migration

**Decision**: nenhuma mudança de schema. As colunas e chaves usadas já existem (`reports.assigned_to_id` com índice
`(status, assigned_to_id)`, PK composta de `report_access_blocks` e índice em `user_id`). A conferência four-eyes no
banco já existe desde o schema inicial (`CHECK reveal_four_eyes`: `decided_by_id IS NULL OR decided_by_id <>
requested_by_id`); esta feature entrega a mesma regra na política (`IdentityRevealPolicy.decide`), e a feature de
revelação (IDV) usa as duas.
