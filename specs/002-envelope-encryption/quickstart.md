# Quickstart: validar a criptografia em envelope

## Pré-requisitos

- Node.js 26.13.1 (fixado no `.tool-versions`; com asdf, `asdf install` na raiz do repositório).
- Docker com Compose.
- `.env` copiado do `.env.example`.

```bash
docker compose up -d                 # Postgres, Vault (com as KEKs e os AppRoles api e maintenance), Redis, S3
npm ci
npm run migration:run
```

## 1. Formato, contexto, adulteração e streaming (unitários)

```bash
npm test -- src/modules/crypto
```

Esperado: ida e volta íntegra; contexto de outro registro, byte alterado, tag alterada, versão desconhecida e tamanho
impossível falham; dois cifrados do mesmo texto diferem; arquivo de 10 MB cifra e decifra com crescimento de memória
abaixo de 5 MB; arquivo cortado ou com blocos trocados falha (US1, US3, US6; SC-001, SC-004).

## 2. Chaves de dados, segredos da aplicação e latência (integração)

```bash
npm run test:e2e -- test/crypto/data-key test/crypto/app-secret test/crypto/latency
```

Esperado: a DEK em claro é zerada depois da função, inclusive com erro; nenhuma chamada ao Vault acontece com
transação aberta; o segredo de MFA não abre com o contexto de outro usuário; o relatório do teste de latência mostra o
p95 de selar e abrir abaixo de 100 ms (US2, US4; SC-003).

## 3. Não vazamento (integração)

```bash
npm run test:e2e -- test/crypto/no-leak
```

Esperado: com relatos curtos (`XQZ`) e longos, nenhuma resposta nem linha de log contém o texto, a DEK ou o valor
cifrado nas falhas forçadas: contexto errado, dado adulterado, versão desconhecida e Vault parado (US5; SC-002).

## 4. Rotação e recifragem

```bash
npm run test:e2e -- test/crypto/rewrap
```

Esperado: depois de girar a `report-kek` e rodar a recifragem, todas as denúncias de teste continuam abrindo, nenhum
byte de `content_enc` muda, uma segunda execução não recifra nada e `KEYS_REWRAPPED` aparece na trilha com ator
"sistema" (US7; SC-005).

Manualmente, no ambiente local:

```bash
docker compose exec -e VAULT_TOKEN=dev-root-token vault vault write -f transit/keys/report-kek/rotate
VAULT_ROLE_ID=dev-maintenance-role-id VAULT_SECRET_ID=dev-maintenance-secret-id npm run cli -- rewrap-keys --kek report-kek
```

Com a credencial da API no lugar da de manutenção, o comando termina com código 1 e a mensagem de falta de permissão.

## 5. Políticas do Vault

```bash
npm run test:e2e -- test/crypto/vault-policies
```

Esperado: cada célula da tabela de [contracts/vault-policies.md](./contracts/vault-policies.md) é conferida; a API
recebe 403 na `identity-kek` e no `rewrap` (US8; SC-006).

## 6. Suíte completa

```bash
npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run test:cov:all && npm run build
```

Esperado: tudo verde, cobertura de `src/modules/crypto` em pelo menos 80% (SC-007) e as factories de teste usando a
camada oficial (`grep -n "createCipheriv" test/support/factories.ts` não encontra nada).
