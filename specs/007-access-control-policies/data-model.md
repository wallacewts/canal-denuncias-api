# Data Model: Controle de acesso

Nenhuma tabela nova e nenhuma migration (research R9). O modelo desta feature são estruturas em código sobre tabelas
que já existem.

## Tabelas lidas (existentes, sem mudança)

| Tabela                     | Colunas usadas                                   | Para quê                                    |
| -------------------------- | ------------------------------------------------ | ------------------------------------------- |
| `reports`                  | `id`, `assigned_to_id`, `shredded_at`            | escopo por atribuição; 410 dentro do escopo |
| `report_access_blocks`     | `report_id`, `user_id` (PK composta)             | conflito de interesse: nega sempre          |
| `identity_reveal_requests` | `requested_by_id` (e o CHECK `reveal_four_eyes`) | four-eyes na decisão da revelação           |
| `users` / `user_roles`     | via identidade da sessão (feature 006)           | perfis relidos a cada requisição            |
| `audit_logs`               | escrita por `AuditService.record()`              | `ACCESS_DENIED`                             |

Nenhum campo cifrado é lido; nenhuma chave de dados é aberta para decidir acesso.

## Estruturas em código

### Catálogo de habilidades (existente, ampliado de forma aditiva)

`ABILITY_CATALOG[code] = { roles, scope, recordScope? }`

- `recordScope` (novo, só em habilidades `scope: 'record'`): `Partial<Record<Role, 'all' | 'assigned'>>`.
- Regra: as chaves de `recordScope` são exatamente os `roles` da habilidade (teste).
- Valores: tabela da research R1. Códigos, perfis e saída do `GET /me` inalterados.

### Descritor de escopo

`ReportScope = { kind: 'all' | 'assigned' | 'none'; userId: string }`

- `reportScope(user, ability)`: união dos perfis da pessoa sobre `recordScope` (`all` > `assigned` > `none`).
- Invariante: o bloqueio por conflito de `userId` é excluído em qualquer `kind`; `none` nunca vira "todas".

### Fatos de acesso de uma denúncia

`ReportAccessFacts = { reportId; exists: boolean; assignedToId: string | null; blockedForUser: boolean;
shreddedAt: Date | null }`

- Carregados por uma única consulta em `ReportAccessService.resolve`, com a mesma forma exista ou não a denúncia.
- `allowsReport(scope, facts)` = `exists && !blockedForUser && (kind = 'all' || (kind = 'assigned' &&
assignedToId = userId))`.

### Resultado do `resolve`

| Situação                                     | Resposta              | Trilha                                             |
| -------------------------------------------- | --------------------- | -------------------------------------------------- |
| id inexistente                               | 404 (corpo padrão)    | `ACCESS_DENIED`, `reason: NOT_FOUND`, `resourceId` |
| existe, fora do escopo (inclusive bloqueio)  | 404 (idêntico)        | `ACCESS_DENIED`, `reason: OUT_OF_SCOPE`            |
| no escopo, expurgada, habilidade de conteúdo | 410 `REPORT_SHREDDED` | — (a leitura de sucesso/expurgo é do domínio)      |
| no escopo                                    | devolve os fatos      | —                                                  |

Ordem fixa: validação do id (400) → consulta → escopo → expurgo.

### Registro de políticas

`POLICY_ABILITIES[PolicyName] = { resourceType: AuditResourceType; abilities: Record<método, Ability> }`

- Fonte do `code` e do `resourceType` gravados pelo assinante nas negações do guard e do `authorize()`.
- Invariante (teste): todo método de política registrado tem um código do catálogo.

### Metadata de `ACCESS_DENIED` (schema ampliado)

| Campo      | Tipo                                   | Quem grava                                   |
| ---------- | -------------------------------------- | -------------------------------------------- |
| `policy`   | nome de classe (regex existente), null | assinante                                    |
| `ability`  | nome de método (regex existente), null | assinante                                    |
| `code`     | enum dos códigos do catálogo           | assinante e `ReportAccessService` (novo)     |
| `reason`   | `OUT_OF_SCOPE` \| `NOT_FOUND`          | `ReportAccessService` (novo)                 |
| `required` | enum `Role`                            | reconferência do `users.service` (existente) |

`resourceType`: o da política (`USER`, `REPORT`, `AUDIT_LOG`, `SETTING`, `CATEGORY`, `REPORTING`, `IDENTITY`);
`SYSTEM` só para rota sem declaração. `resourceId`: só no 404 de denúncia (id já validado).
