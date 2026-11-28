# Quickstart: validar o controle de acesso

## Pré-requisitos

- Node 26.13.1 (`.tool-versions`), `npm ci`.
- `docker compose up -d` (Postgres 18, Vault de dev, Redis) e `npm run migration:run` (nenhuma migration nova).

## Cenários

1. **Matriz (US1, SC-001)**: `npm test -- access-control` — teste em tabela perfil (isolado e combinado) × método de
   política × situação (atribuída, de outro, sem atribuição, com conflito); catálogo × matriz de
   `docs/tarefas/05-access-control.md` × `recordScope`. Detalhe na [research](research.md) R1, R8.
2. **Escopo único (US3, SC-002, SC-003)**: `npm run test:e2e -- test/access-control` — cenário do ACL-03 (3
   analistas, gestora com bloqueio, DPO com bloqueio, 10 denúncias) com o conjunto esperado escrito à mão, e a prova
   exaustiva "listado ⇔ leitura permitida".
3. **Denúncia por id (US2, US4, SC-005, SC-006)**: na rota só de teste, analista sem atribuição e id inexistente →
   mesmo 404 (código e corpo) e um `ACCESS_DENIED` cada (`OUT_OF_SCOPE`/`NOT_FOUND`); gestora e DPO bloqueados → 404;
   expurgada no escopo → 410, fora → 404; DPO tratando → 403; aprovar o próprio pedido de revelação → 403.
4. **Tempo (SC-006)**: `npm run test:timing` — diferença das medianas entre "fora do escopo" e "inexistente" menor
   que 10% da menor mediana (piso de 1 ms), 40 amostras alternadas.
5. **Trilha migrada (FR-005)**: Auditor 200 em `GET /api/admin/v1/audit-logs`; outro perfil 403 com `ACCESS_DENIED`
   (`policy: AuditPolicy`, `code: audit.read`, `resourceType: audit_log`).
6. **Convenção (US5, SC-004)**: `npm run test:e2e -- test/conventions` — toda rota administrativa declara permissão;
   o controller de teste sem declaração é encontrado e nomeado; nenhum log "declare no check" na inicialização.
7. **Nada mudou para o front (SC-007)**: `npm run openapi:export` sem diferença; `GET /me` com os mesmos códigos.
8. **Qualidade**: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run test:cov` (domínio ≥ 80%).

Contrato interno para as features de domínio: [contracts/access-control.md](contracts/access-control.md).
