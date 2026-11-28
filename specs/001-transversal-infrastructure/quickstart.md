# Quickstart: validar a infraestrutura transversal

Guia para provar, de ponta a ponta, que a feature funciona. Detalhes dos formatos estão em [contracts/](./contracts/)
e [data-model.md](./data-model.md).

## Pré-requisitos

```bash
cp .env.example .env            # agora com Redis, Vault, S3, SMTP, ClamAV e segredos
npm ci
docker compose up -d            # Postgres, Vault (com as KEKs), Redis, S3, Mailpit
npm run migration:run
```

## 1. Testes automatizados

```bash
npm test             # unitários: filtro de erro, validação, env schema, cursor, password policy, job schema
npm run test:e2e     # integração: Vault, fila, storage, convenções de rota, logs sem IP, create-admin
```

Esperado: tudo verde. Os testes de privacidade (erro 500 sem texto de relato, validação sem eco, log de rota pública
sem IP, rota pública sem cookie e com `no-store`, recusa da `identity-kek`) estão entre eles e precisam ter falhado
antes da implementação.

## 2. Configuração insegura impede a inicialização

```bash
NODE_ENV=production VAULT_TOKEN=x node --env-file=.env dist/main.js   # esperado: não sobe, cita VAULT_TOKEN
SESSION_SECRET=curto node --env-file=.env dist/main.js                # esperado: não sobe, cita SESSION_SECRET
```

## 3. Erro seguro e validação

Com a API rodando (`npm run start:dev`), numa rota de exemplo coberta pelos testes:

- campo extra → 400 com `code: unrecognized_keys`, sem repetir a chave;
- texto longo → 400 com `code: too_big`, sem repetir o texto;
- todo erro traz `requestId`, e esse mesmo id aparece na linha de log da requisição.

## 4. Vault indisponível

```bash
docker compose stop vault
# chamar a rota de exemplo que usa o serviço de chaves → 503 em até 3 s
docker compose start vault && docker compose up vault-init
```

## 5. Contrato OpenAPI

```bash
npm run openapi:export   # gera openapi/public.json e openapi/admin.json
git diff --exit-code openapi/   # sem diferença quando o contrato commitado está em dia
```

Esperado: `public.json` só com caminhos `/api/public/v1/*` e `admin.json` só com `/api/admin/v1/*`, cada um com os
schemas que usa. No front, `npm run api:sync` gera os clientes `public` e `admin` a partir desses arquivos.

## 6. Primeiro administrador

```bash
npm run cli -- create-admin --name "Admin" --email "admin@exemplo.local"   # pede a senha sem eco
npm run cli -- create-admin --name "Outro" --email "outro@exemplo.local"   # esperado: recusa (já existe ADMIN)
```

Conferir em `audit_logs` um `USER_CREATED` com `actor_type = SYSTEM` e sem dado pessoal em `metadata`.

## 7. Proxy de referência

Seguir `docs/deploy/proxy.md`: subir o nginx de referência na frente da API, chamar uma rota pública e uma
administrativa e conferir que só a administrativa gera access log, e que a API não recebe `X-Forwarded-For` na rota
pública.

## Resultado da validação (2026-11-27)

| Cenário                    | Resultado                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Testes automatizados    | 110 unitários e 82 de integração passando. Cobertura combinada (`npm run test:cov:all`) de 95% das instruções, com `src/common` e `src/infra` acima de 80% |
| 2. Configuração insegura   | Produção com `VAULT_TOKEN` e segredo curto recusam a inicialização, citando só o nome da variável                                                          |
| 3. Erro seguro e validação | Coberto pelos testes de integração. No container de produção, JSON malformado curto e cursor inválido respondem com mensagem fixa                          |
| 4. Vault indisponível      | 503 em menos de 3 s (`test/http/key-service-unavailable.e2e-spec.ts`, também com o Vault do compose parado)                                                |
| 5. Contrato OpenAPI        | `openapi/public.json` e `openapi/admin.json` gerados sem banco e em dia com o código                                                                       |
| 6. Primeiro administrador  | No container de produção: recusa sem TTY; com terminal, senha sem eco, hash `$scrypt$ln=17` e `USER_CREATED` com ator `SYSTEM`                             |
| 7. Proxy de referência     | `smoke-test.sh` com as 12 verificações passando, e falhando quando a configuração é adulterada                                                             |
