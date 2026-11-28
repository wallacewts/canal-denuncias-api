# Quickstart: validar a trilha de auditoria completa

## Pré-requisitos

- Node 26.13.1 (`.tool-versions`), `npm ci`, `.env` a partir do `.env.example` (inclui
  `DATABASE_AUDIT_MAINTENANCE_URL`).
- `docker compose up -d` com o volume do Postgres recriado se o perfil `app_audit_maintenance` ainda não existir
  (`docker compose down -v` apaga os dados de desenvolvimento), e `npm run migration:run`.

## Cenários

1. **Catálogo e metadata** (US1): `npm test -- audit-catalog audit-metadata` passa; ação fora do catálogo e metadata com
   `{"texto":"XQZ"}` são recusadas sem `XQZ` na mensagem nem no log.
2. **Ator por contexto** (US2): `npm run test:e2e -- audit-context`. Rota pública de fixture com `X-Forwarded-For`
   grava `REPORTER` sem IP; rota admin com identidade de teste grava `STAFF` com IP; o comando grava `SYSTEM`.
3. **@Audited** (US3): `npm run test:e2e -- audited`. Sucesso, 403 e erro geram `SUCCESS`, `DENIED` e `FAILURE`.
4. **Imutabilidade** (US4): `npm run test:e2e -- audit-immutability`. `app_runtime` não altera nem apaga (pai e
   partição); `app_migrator` não altera, apaga nem esvazia (pai e partição); denunciante com IP é recusado.
5. **Consulta** (US5): `npm run test:e2e -- audit-query`. Auditor recebe páginas decrescentes; outro perfil, 403; sem
   identidade, 401; filtro inválido, 400 sem eco.
6. **Verificação** (US6): `npm run cli -- verify-audit` imprime `"ok": true` e sai com 0. O teste
   `audit-verifier` altera um registro com o gatilho desligado (só no teste) e confirma `ok: false` com o id certo.
7. **Partições e expurgo** (US7): `npm run test:e2e -- audit-retention`. Partições com mais de 5 anos somem pelo
   `audit-maintenance`, a âncora é gravada, a verificação continua íntegra; partição recente e `app_runtime` são
   recusados; lacuna sem âncora é quebra.
8. **Migração** (US7): `npm run test:e2e -- audit-partitioning-migration`. Migra uma trilha com registros, confere a
   cadeia antes e depois, roda o `down()` e confere de novo.
9. **Desempenho**: `npm run test:e2e -- audit-performance` registra o tempo de verificação de 100.000 registros e da
   primeira página da consulta (limites só fora do CI).
10. **Divergência**: `npm run migration:generate -- /tmp/DriftCheck` responde "No changes".
