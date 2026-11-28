# Contrato: convenções de rota (TRV-07)

| Área        | Decorator               | Prefixo                                         | Tag OpenAPI | Regras automáticas                                                                                                                                         |
| ----------- | ----------------------- | ----------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Denunciante | `@PublicApi('recurso')` | `/api/public/v1/recurso`                        | `public`    | `Cache-Control: no-store`, `Pragma: no-cache`, nenhum `Set-Cookie` (removido se algo tentar definir), token do denunciante só no cabeçalho `Authorization` |
| Equipe      | `@AdminApi('recurso')`  | `/api/admin/v1/recurso`                         | `admin`     | `Cache-Control: no-store` e `Pragma: no-cache` em **toda** resposta. A declaração de permissão por rota vem com ACL-02                                     |
| Infra       | nenhum                  | `/health`, `/ready`, `/docs` (fora de produção) | —           | já existentes                                                                                                                                              |

**Parâmetros de caminho em rotas públicas**: só `:attachmentId`, validado como UUID. Qualquer outro parâmetro faz o
teste `test/conventions/public-routes.e2e-spec.ts` falhar. Protocolo, chave e dados pessoais vão sempre no corpo.

**Verificação**: o teste lista os controllers com metadado público via `DiscoveryService` e confere: prefixo,
parâmetros permitidos, ausência de `Set-Cookie` e presença de `no-store` numa chamada real a uma rota de exemplo.
