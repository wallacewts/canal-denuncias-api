# Contrato: exportação do OpenAPI (TRV-11)

Consumido pelo `npm run api:sync` do front (`canal-denuncias-web`), que gera dois clientes com o `ng-openapi-gen`.

| Item           | Valor                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Comando        | `npm run openapi:export` (sem banco, sem Vault, sem rede)                                                  |
| Saída          | `openapi/public.json` e `openapi/admin.json`, na raiz do repositório da API                                |
| Formato        | OpenAPI 3.1, JSON com indentação de 2 espaços e chaves em ordem estável (diff limpo)                       |
| `public.json`  | Só caminhos que começam com `/api/public/v1/`. Tag `public`                                                |
| `admin.json`   | Só caminhos que começam com `/api/admin/v1/`. Tag `admin`                                                  |
| Schemas        | Cada arquivo leva só os `components/schemas` que suas operações referenciam, inclusive `ApiError` e `Page` |
| Fora dos dois  | `/health`, `/ready` e `/docs`                                                                              |
| `info.version` | Versão do `package.json` da API                                                                            |
| Versionamento  | Os arquivos são commitados. O CI regenera e falha se `git diff --exit-code openapi/` encontrar diferença   |

**Para o front**: ler a partir do caminho do repositório da API (ex.: `../canal-denuncias-api/openapi/public.json`)
ou do artefato do CI. Os IDs de operação seguem `<Controller>_<método>` e são estáveis entre exportações.
