# Proxy reverso da API

O anonimato do denunciante não depende só da API: um proxy que registra IPs ou repassa cabeçalhos de origem desfaz
tudo o que a API protege. Este documento explica a configuração de referência
[`nginx/canal-denuncias.conf`](nginx/canal-denuncias.conf) e o que **não pode** ser alterado.

## O que a configuração garante

| Diretiva                                                              | Onde                                         | Por quê                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `access_log off`                                                      | padrão do servidor, `/api/public/`, porta 80 | Nenhum registro de acesso que ligue um IP a uma denúncia. O redirecionamento HTTP → HTTPS também não registra                         |
| `error_log ... crit`                                                  | padrão e `/api/public/`                      | O error log do nginx inclui `client: <IP>` em erros de cliente (ex.: corpo grande demais). Na área pública só entra o que for crítico |
| `proxy_set_header X-Forwarded-For ""`, `X-Real-IP ""`, `Forwarded ""` | `/api/public/`                               | A API não recebe o IP de origem do denunciante, nem cabeçalhos forjados pelo cliente                                                  |
| `proxy_set_header User-Agent ""`, `Referer ""`                        | `/api/public/`                               | Reduz a impressão digital do navegador. A API já não registra esses dados; o proxy garante que eles nem cheguem                       |
| `access_log /dev/stdout canal_admin`                                  | `/api/admin/`                                | Ações da equipe são auditadas com IP. O formato não inclui query string, user-agent nem referer                                       |
| `proxy_set_header X-Forwarded-For $remote_addr`                       | `/api/admin/`                                | Substitui o cabeçalho (não acrescenta), para o cliente não forjar IPs anteriores. A API usa `trust proxy = 1`                         |
| `ssl_protocols TLSv1.2 TLSv1.3`                                       | servidor 443                                 | Só versões seguras de TLS                                                                                                             |
| `Strict-Transport-Security max-age=31536000; includeSubDomains`       | servidor 443                                 | O navegador passa a usar sempre HTTPS                                                                                                 |
| `client_max_body_size 10m`                                            | servidor 443                                 | Igual a `MAX_ATTACHMENT_BYTES` da API. Mudou um, mude o outro                                                                         |
| `server_tokens off`                                                   | http                                         | Não expõe a versão do nginx                                                                                                           |
| `location / { return 404; }`                                          | servidor 443                                 | Só a API passa por este proxy. Portal e backoffice têm servidores próprios                                                            |

## Como usar

1. Copie `nginx/canal-denuncias.conf` para `/etc/nginx/conf.d/` do proxy.
2. Ajuste `server api:3000` no bloco `upstream` para o endereço interno da API.
3. Coloque o certificado e a chave em `/etc/nginx/certs/tls.crt` e `/etc/nginx/certs/tls.key`.
4. Valide com `nginx -t` e rode o teste de fumaça abaixo contra a configuração final.

## Teste de fumaça

```bash
bash docs/deploy/nginx/smoke-test.sh
```

Sobe o nginx com a configuração na frente de um upstream que devolve os cabeçalhos recebidos e confere: rota
pública sem access log e sem cabeçalhos de origem, rota administrativa com log e IP, TLS 1.2 e 1.3, HSTS, versão
oculta e 413 acima de 10 MB sem IP no log. Precisa de Docker, `curl` e `openssl`.

Rode o teste sempre que alterar a configuração. Uma alteração que faça o teste falhar não pode ir para produção.

## O que não pode ser alterado

- Ligar `access_log` em `/api/public/` ou no servidor da porta 80.
- Remover a limpeza de `X-Forwarded-For`, `X-Real-IP` e `Forwarded` em `/api/public/`.
- Baixar o nível do `error_log` da área pública.
- Expor a API sem este proxy, ou colocar outro proxy na frente (CDN, WAF, balanceador) que registre IPs ou acrescente
  cabeçalhos de origem nas rotas públicas.

Qualquer exceção precisa de decisão registrada em [`docs/adr/README.md`](../adr/README.md).
