# 00 · Infraestrutura transversal

**Objetivo:** preparar o que todos os módulos usam: erros, validação, convenções de rota, clientes de Vault, Redis e
storage S3, CLI administrativa e base de testes.

**Depende de:** nada (é a base).

**Status:** concluído na feature `specs/001-transversal-infrastructure` (2026-11-27). Decisões D27 a D33.

**Legenda:** estimativa P (até 1 dia), M (2 a 3 dias), G (4 a 5 dias). Marcos: MVP, Produção (obrigatório antes de
dados reais), Evolução.

---

### TRV-01 · Filtro global de exceções e formato de erro

**Estimativa:** M · **Marco:** MVP

Um único `ExceptionFilter` global define o corpo de erro da API e garante que nenhum dado sensível vaze em respostas
ou logs.

- **Arquivos:** `src/common/http/http-exception.filter.ts`, registro em `main.ts` ou `APP_FILTER`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma (a auditoria de negação fica em ACL-04).

**Critérios de aceite**

- [x] Corpo padrão `{ statusCode, error, message, requestId }`. `requestId` é o mesmo id do log da requisição.
- [x] Erro inesperado responde 500 com mensagem genérica. A stack vai só para o log, nunca para a resposta.
- [x] Violação de unique (`23505`) vira 409 e de FK (`23503`) vira 409 ou 404, sem expor nome de constraint.
- [x] O filtro nunca copia o corpo da requisição para o log nem para a resposta.
- [x] Teste unitário para 400, 401, 403, 404, 409 e 500. Teste garantindo que um erro com texto de relato na mensagem
      original não aparece na resposta 500.

### TRV-02 · Validação de entrada (decisão + pipe global)

**Estimativa:** P · **Marco:** MVP

O registro de decisões cita `class-validator`, mas o Nest 12 valida nativamente com Standard Schema (zod já está no
projeto para as variáveis de ambiente). Decidir e configurar uma única abordagem.

- **Arquivos:** `src/common/validation/`, ADR em `docs/adr/`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] ADR registrando a escolha (recomendação: zod com `StandardSchemaValidationPipe`, menos dependências e um só
      jeito de validar).
- [x] Campos desconhecidos são rejeitados (400), não ignorados em silêncio.
- [x] Limites de tamanho em todo campo de texto livre.
- [x] Mensagens de erro de validação não repetem o valor recebido (evita ecoar relato ou senha).
- [x] Teste de um DTO de exemplo com campo extra, campo longo demais e tipo errado.

### TRV-03 · Variáveis de ambiente dos serviços externos

**Estimativa:** P · **Marco:** MVP

Hoje `.env.example` lista Redis, Vault, S3, SMTP e ClamAV, mas `env.schema.ts` só valida o básico.

- **Arquivos:** `src/config/env.schema.ts`, `.env.example`, `docker-compose.yml`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] Validação de `REDIS_URL`, `VAULT_ADDR`, autenticação do Vault (token em dev, AppRole `VAULT_ROLE_ID` e
      `VAULT_SECRET_ID` em produção), `S3_*`, `SMTP_*`, `CLAMAV_*` e os segredos de sessão e token do denunciante
      (mínimo de 32 bytes).
- [x] Em `NODE_ENV=production`, token raiz do Vault é recusado na inicialização.
- [x] Teste do schema: produção sem AppRole falha, segredo curto falha.

### TRV-04 · Cliente do Vault

**Estimativa:** M · **Marco:** MVP

Módulo `VaultModule` com as chamadas do Transit que o `crypto` vai usar.

- **Arquivos:** `src/infra/vault/vault.module.ts`, `vault.client.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma (quem audita é o chamador).

**Critérios de aceite**

- [x] Autenticação por token (dev) e AppRole (produção), com renovação do token antes de expirar.
- [x] Métodos `generateDataKey(kek)`, `decryptDataKey(kek, wrapped)`, `encrypt(kek, plaintext)`,
      `decrypt(kek, ciphertext)`, `rewrap(kek, ciphertext)`.
- [x] Timeout por chamada (ex.: 2 s) e erro claro quando o Vault está selado ou fora do ar (503 para o cliente da API).
- [x] Nenhum plaintext ou chave em log, nem em mensagem de exceção.
- [x] Teste de integração contra o Vault do docker-compose.

### TRV-05 · Redis e BullMQ

**Estimativa:** P · **Marco:** MVP

Conexão Redis compartilhada e filas com padrões seguros.

- **Arquivos:** `src/infra/queue/queue.module.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] `BullModule.forRootAsync` com `REDIS_URL`. Filas registradas: `notifications`, `maintenance`.
- [x] Padrões de job: `attempts` com `backoff` exponencial, `removeOnComplete` e `removeOnFail` limitados, `jobId`
      derivado da tarefa (idempotência).
- [x] Payload de job contém só IDs, nunca conteúdo de denúncia.
- [x] Jobs agendados rodam em uma única instância (`@nestjs/locks` ou lock no Redis).

### TRV-06 · Storage S3

**Estimativa:** M · **Marco:** Produção (necessário para anexos)

Cliente para o storage S3-compatível (SeaweedFS local, outro em produção).

- **Arquivos:** `src/infra/storage/storage.module.ts`, `storage.service.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] Decidir entre `@aws-sdk/client-s3` e o pacote oficial `@nestjs/storage` (registrar no ADR).
- [x] Operações em streaming: `put`, `get`, `delete`, `deleteMany`, `head`.
- [x] Criação do bucket na inicialização apenas em desenvolvimento.
- [x] Teste de integração contra o SeaweedFS do docker-compose.

### TRV-07 · Convenções de rota pública e administrativa

**Estimativa:** P · **Marco:** MVP

Decorators que fixam o prefixo e o tratamento de cada área: `@PublicApi('recurso')` gera
`/api/public/v1/recurso` e `@AdminApi('recurso')` gera `/api/admin/v1/recurso`.

- **Arquivos:** `src/common/http/route-decorators.ts`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] Teste que percorre todas as rotas registradas e falha se uma rota pública tiver parâmetro de caminho que possa
      carregar protocolo, chave ou dado pessoal (só UUID de anexo é permitido).
- [x] Rotas públicas nunca definem cookie (o token do denunciante vai no cabeçalho `Authorization`).
- [x] Respostas de rotas públicas e de dados sensíveis enviam `Cache-Control: no-store`.

### TRV-08 · Paginação por cursor

**Estimativa:** P · **Marco:** MVP

Utilitário de paginação usado nas listagens (denúncias, usuários, auditoria).

- **Arquivos:** `src/common/pagination/`.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] `?limit=&after=` com `limit` máximo de 100. Resposta `{ items, nextCursor }`.
- [x] Cursor baseado no UUID v7 (ordenável por tempo). Sem `OFFSET` e sem `COUNT(*)`.

### TRV-09 · CLI administrativa e comando `create-admin`

**Estimativa:** M · **Marco:** MVP · **Depende de:** USERS-01, AUTH-00

`nest-commander` com o primeiro comando: criar o primeiro ADMIN sem colocar senha em migration.

- **Arquivos:** `src/cli.ts`, `src/cli/create-admin.command.ts`, script `npm run cli`.
- **Endpoints:** nenhum.
- **Auditoria:** `USER_CREATED` com `actorType = SYSTEM`.

**Critérios de aceite**

- [x] `npm run cli -- create-admin --name "..." --email "..."` pede a senha de forma interativa (sem eco) e aplica a
      mesma política de senha da API.
- [x] Recusa criar se já existir um ADMIN ativo, a menos que receba `--force`, que também é auditado.
- [x] O usuário criado precisa cadastrar o MFA no primeiro login.
- [x] Funciona no container de produção (`node dist/cli.js create-admin`).

### TRV-10 · Base de testes

**Estimativa:** M · **Marco:** MVP

Infraestrutura para testes de integração e e2e consistentes.

- **Arquivos:** `test/support/` (app de teste, factories, limpeza de banco).
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] Helper que sobe o app com a mesma configuração de `main.ts` (prefixo, pipes, filtros).
- [x] Factories para usuário (com perfis), categoria e denúncia já cifrada.
- [x] Limpeza entre testes que respeita a auditoria append-only (banco por suíte ou schema descartável).
- [x] Custo do hash de senha reduzido nos testes.
- [x] Helper que captura as linhas de log de uma requisição, para testes de "não vazou no log".

### TRV-11 · Documentação OpenAPI

**Estimativa:** P · **Marco:** MVP

- **Arquivos:** `main.ts`.
- **Endpoints:** `GET /docs` (fora de produção).
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] Tags separadas para `public` e `admin`. Schemas de entrada e saída aparecem no documento.
- [x] O documento OpenAPI é exportado no CI (`openapi.json` como artefato) para gerar o cliente do front.

### TRV-12 · Configuração de referência do proxy reverso

**Estimativa:** P · **Marco:** Produção

O anonimato também depende do proxy. Entregar uma configuração de referência (nginx ou Traefik) em `docs/deploy/`.

- **Arquivos:** `docs/deploy/proxy.md` e exemplo de configuração.
- **Endpoints:** nenhum.
- **Auditoria:** nenhuma.

**Critérios de aceite**

- [x] Sem access log para `/api/public/`. Access log com IP permitido só em `/api/admin/`.
- [x] TLS 1.2 ou superior (de preferência 1.3), HSTS, limite de tamanho de corpo compatível com os anexos.
- [x] `X-Forwarded-For` removido das rotas públicas antes de chegar na API.
