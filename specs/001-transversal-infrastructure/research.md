# Research: Infraestrutura transversal da API

**Feature**: [spec.md](./spec.md) | **Plano**: [plan.md](./plan.md) | **Data**: 2026-11-27

Versões conferidas no npm em 2026-11-27. As decisões R6 e R7 foram respondidas pelo usuário (Q-P1: B, Q-P2: A). Cada decisão abaixo vira uma linha no registro de decisões
(`docs/adr/README.md`) antes do código, conforme o princípio IX.

## R1. Validação de entrada (TRV-02) → D27

- **Decision**: zod 4 (`zod@4.6.7`, já instalado) com o `StandardSchemaValidationPipe` nativo do Nest 12, registrado
  como pipe global. Todo schema de entrada usa `z.strictObject()` e helpers próprios com limite de tamanho
  obrigatório para texto (`text({ max })`).
- **Rationale**:
  - Um só jeito de validar: o projeto já usa zod para as variáveis de ambiente.
  - `z.strictObject()` recusa campos desconhecidos com 400 (FR-006). Com class-validator, o padrão
    (`whitelist: true`) descarta o campo em silêncio, e é preciso lembrar de `forbidNonWhitelisted`.
  - Por padrão, as issues do zod 4 **não** carregam o valor recebido (`reportInput` vem desligado). Conferido:
    `{"code":"too_big","maximum":5,"path":["t"],"message":"Too big: expected string to have <=5 characters"}`
    (FR-008). A exceção é `unrecognized_keys`, que repete o nome da chave enviada. O mapeamento de erro devolve só o
    código e o caminho, sem a lista de chaves.
  - O `@nestjs/swagger` 12 converte schemas Standard Schema em OpenAPI sem configuração extra
    (`standard-schema-openapi.converter`), o que atende TRV-11.
  - Menos dependências: nada de `class-validator@0.15.1` nem `class-transformer@0.5.1` (este sem release desde 2022).
- **Alternatives considered**:
  - `class-validator` + `class-transformer`: previsto no registro de decisões original. Rejeitado por exigir duas
    dependências a mais, uma delas sem manutenção, e por ignorar campos desconhecidos por padrão.
- **Impacto**: atualiza a linha "Validação" da seção de bibliotecas. A decisão D27 substitui o class-validator.

## R2. Cliente do Vault (TRV-04) → D28

- **Decision**: cliente próprio e enxuto sobre o `fetch` nativo do Node 26, com `AbortSignal.timeout(2000)` em toda
  chamada. Ele implementa só o que o projeto usa: login AppRole, renovação do token, e no Transit `datakey/plaintext`,
  `decrypt`, `encrypt` e `rewrap`.
- **Rationale**:
  - O `node-vault@0.13.0` traz `axios`, `mustache`, `tv4` e `debug`. Os erros do axios carregam `config.data`, ou
    seja, o corpo da requisição, que no Transit é o **plaintext** ou a chave. Basta um `logger.error(err)` para vazar
    o dado (FR-015). Com cliente próprio, as exceções são criadas pelo projeto e nunca contêm corpo.
  - São 6 endpoints REST estáveis do Vault. Isso dá menos código para revisar do que integrar e blindar uma biblioteca
    genérica.
  - Menos dependências de terceiros no caminho das chaves reduz o risco de cadeia de suprimentos.
- **Alternatives considered**:
  - `node-vault`: rejeitado pelo risco de vazamento nos erros e pelas dependências.
  - Não há pacote oficial do Nest para o Vault.
- **Detalhes**:
  - Dev: `VAULT_TOKEN`. Produção: `VAULT_ROLE_ID` + `VAULT_SECRET_ID` (AppRole), com o token renovado quando 2/3 do
    TTL tiverem passado e um novo login se a renovação falhar.
  - Vault selado, fora do ar ou com timeout geram `KeyServiceUnavailableError`, que o filtro global converte em 503
    (FR-014).

## R3. Storage S3 (TRV-06) → D29

- **Decision**: `@aws-sdk/client-s3@3.1179.0` com `@aws-sdk/lib-storage@3.1179.0` (upload multipart em fluxo
  contínuo), `forcePathStyle: true` para o SeaweedFS.
- **Rationale**:
  - O princípio VIII manda avaliar primeiro o pacote oficial. O `@nestjs/storage@0.0.5` foi publicado há 3 semanas,
    está em versão 0.0.x e ainda não tem histórico de estabilidade. O SDK da AWS é o padrão de fato para qualquer
    storage S3-compatível e é usado em produção há anos.
  - O `lib-storage` faz multipart com stream sem carregar o arquivo em memória (US10).
  - `DeleteObjects` atende `deleteMany` numa chamada.
- **Alternatives considered**:
  - `@nestjs/storage`: rejeitado por imaturidade. Reavaliar quando passar de 1.0.
  - `minio-js`: amarrado a um fornecedor que deixou de publicar imagens.

## R4. Fila e jobs agendados (TRV-05) → D30

- **Decision**: `@nestjs/bullmq@12.0.2` + `bullmq@6.7.10`. Jobs agendados usam os **job schedulers** do próprio
  BullMQ (`upsertJobScheduler`), sem biblioteca de lock.
- **Rationale**:
  - Os job schedulers ficam guardados no Redis e o BullMQ gera **um** job por disparo, não importa quantas instâncias
    estejam rodando. Isso garante uma execução por agenda (FR-019) sem lock extra.
  - Padrões aplicados a todas as filas: `attempts: 5`, `backoff` exponencial a partir de 5 s,
    `removeOnComplete: { count: 1000 }`, `removeOnFail: { count: 5000 }` e `jobId` derivado da tarefa (FR-017).
  - O payload é tipado com um schema zod que só aceita identificadores (UUID). Um teste falha se alguém incluir texto
    livre (FR-018).
- **Alternatives considered**:
  - `@nestjs/schedule` (`@Cron`) + `@nestjs/locks@0.0.6`: o `@Cron` roda em todas as instâncias e exigiria lock.
    O `@nestjs/locks` está em versão 0.0.x. Rejeitado.
  - Lock próprio no Redis (`SET NX PX`): desnecessário com os job schedulers.

## R5. CLI administrativa (TRV-09) → D31

- **Decision**: `nest-commander@3.21.0` (peer `@nestjs/common ^12` declarado) com o entrypoint `src/cli.ts`
  compilado para `dist/cli.js`. A senha é lida do TTY sem eco por um prompt próprio sobre `node:readline`, para não
  trazer `inquirer`.
- **Rationale**: o `nest-commander` reaproveita os módulos do Nest (repositório de usuários, auditoria) sem subir o
  servidor HTTP. O pacote é CommonJS, e o import a partir do ESM funciona com interop padrão. Isso será confirmado na
  primeira tarefa.
- **Alternatives considered**: script avulso com `NestFactory.createApplicationContext`. Funciona, mas cada comando
  futuro reimplementaria o parse de argumentos.

## R6. Hash de senha da equipe (TRV-09) → D32 (altera D03, adianta parte do AUTH-00)

- **Decision** (usuário, 2026-11-27, Q-P1 opção B): usar o `PasswordHasher` do pacote oficial
  `@nestjs/authentication`, com a versão fixada sem faixa (`0.1.8`). Ele faz scrypt com `crypto.scrypt` do Node,
  no threadpool, e grava um hash autodescritivo (`$scrypt$ln=17,r=8,p=1$salt$hash`) que vale para toda a senha da
  equipe. **Isso altera a D03** (argon2id → scrypt) e **antecipa o AUTH-00** a favor do pacote oficial, pelo menos no
  hash de senha.
- **Como é usado nesta feature**: só o hasher. O `AuthModule` provê `PasswordHasher` por factory
  (`new PasswordHasher({ logN })`), **sem** importar `AuthenticationModule.forRoot()`. Importar o módulo registraria
  o guard global (todas as rotas passam a responder 401) e exigiria stores, e as duas coisas são escopo da feature de
  auth. Quando o AUTH registrar o `AuthenticationModule`, o provider passa a vir do próprio módulo, com o mesmo
  `logN`.
- **Conferido na versão 0.1.8** (instalada numa pasta temporária, fora do repositório):
  - API: `hash(password)`, `verify(password, encoded | undefined)` em tempo constante e com hash falso para
    usuário inexistente, `needsRehash(encoded)`.
  - Opções: `logN` de 10 a 22 (padrão 17, cerca de 128 MiB), `r`, `p`, `keyLength` e `saltLength`.
  - `hash()` recusa senha vazia e acima de 4 KiB. As regras de tamanho e força são da aplicação.
  - Zero dependências. Os peers `@nestjs/websockets` e `@nestjs/microservices` são opcionais.
  - Teste local: `$scrypt$ln=10,r=8,p=1$...`, `verify` certo e errado ok e `needsRehash` verdadeiro ao subir para
    `logN` 17.
- **Custo**: `logN = 17` em produção e desenvolvimento. No ambiente de teste, `PASSWORD_HASH_LOG_N=10` (só aceito
  com `NODE_ENV=test`), atendendo FR-035.
- **Política de senha** (a mesma da API, de AUTH-04): mínimo de 12 caracteres e recusa de senhas comuns por lista
  local, sem consulta externa. A lista entra no repositório como arquivo de dados. A checagem é nossa e roda antes do
  `hash()`.
- **Riscos registrados**:
  - **Maturidade**: o pacote está na 0.1.x (publicado em 2026-11-26), e a API pode mudar entre versões menores. Por
    isso a versão fica fixada e o Dependabot propõe as atualizações, que só entram depois de rodar os testes do
    hasher e do login.
  - **Store em produção**: com `NODE_ENV=production`, o `AuthenticationModule` se recusa a subir com stores em
    memória para os recursos configurados (sessões, refresh tokens, MFA). A feature de auth precisa implementar um
    store sobre o Postgres (`AuthenticationStorage.registerSource()`), usando ou adaptando as tabelas `sessions` e
    `recovery_codes`. Nada disso afeta esta feature, que não importa o módulo.
- **Fora desta feature**: o hash da chave do denunciante continua argon2id, conforme D05. Esta decisão vale só para a
  senha da equipe. A feature de reports/public-tracking decide se unifica no scrypt do pacote ou mantém o argon2id.
- **Alternatives considered**:
  - A (argon2id agora, com `argon2`) e C (`PasswordHasher` próprio em formato PHC). Descartadas pelo usuário.

## R7. Escopo da TRV-09: USERS-01 e núcleo da AUDIT-02 → D33

- **Decision** (usuário, 2026-11-27, Q-P2 opção A): trazer para esta feature só o núcleo da AUDIT-02,
  `AuditService.record()` com cadeia de hash, `pg_advisory_xact_lock`, `occurred_at` definido pela aplicação,
  metadata canônica e `EntityManager` opcional para gravar na transação do chamador. O restante do módulo de
  auditoria (contexto do ator, interceptor, consulta e verificação da cadeia) continua na feature 02.
- **USERS-01** entra inteira: é pequena (P), não tem dependências além das entidades que já existem e é por ela que o
  `create-admin` grava o usuário.
- **Rationale**: o princípio V exige que a criação do administrador seja auditada na mesma transação. Criar sem
  auditoria (opção B) violaria a constituição, e adiar a TRV-09 (opção C) contradiz a Q1.

## R8. Base de testes (TRV-10)

- **Decision**: um banco por suíte, clonado de um banco-modelo. O setup global roda as migrations uma vez em
  `canal_test_template`, e cada arquivo de teste cria `canal_test_<id>` com `CREATE DATABASE ... TEMPLATE` e o
  descarta no fim.
- **Rationale**: `audit_logs` não aceita `DELETE` nem `TRUNCATE`, nem do dono (trigger), então limpar tabelas não é
  possível. Clonar o modelo leva milissegundos e isola as suítes. Isso exige um usuário com `CREATEDB` só no
  ambiente de teste: o `postgres` do compose e o serviço do CI.
- **Captura de log**: a factory do logger aceita um destino (`DestinationStream`) injetável. No teste, um stream em
  memória guarda as linhas por `requestId`.
- **Hash de senha nos testes**: o `PasswordHasher` lê o custo da configuração. No ambiente de teste usa um custo
  mínimo (FR-035).
- **Alternatives considered**: schema por suíte. Rejeitado porque a função e os triggers da auditoria ficam no schema
  `public`, o que complica a migração por schema.

## R9. Exportação do OpenAPI (TRV-11)

- **Decision**: o script `npm run openapi:export` (`src/scripts/export-openapi.ts`, compilado para `dist/scripts/` por causa dos decorators) gera **dois documentos** em caminho
  estável e versionado no repositório: `openapi/public.json`, com as rotas `/api/public/v1/*`, e
  `openapi/admin.json`, com as rotas `/api/admin/v1/*`. O script sobe o app com
  `NestFactory.create(AppModule, { preview: true })`, sem instanciar providers e sem banco ou Vault, gera o documento
  completo com `SwaggerModule.createDocument` e o separa pelo prefixo do caminho. Cada arquivo leva só os
  `components/schemas` que suas rotas referenciam. As tags `public` e `admin` continuam aplicadas pelos decorators
  `@PublicApi` e `@AdminApi`.
- **Requisito do front**: o `npm run api:sync` do front lê esses arquivos para gerar dois clientes com o
  `ng-openapi-gen`: `public` e `admin`. Com documentos separados, o bundle do portal não recebe tipos nem
  operações do backoffice.
- **Versionamento**: os dois arquivos entram no Git. O CI roda o export e falha se houver diferença
  (`git diff --exit-code openapi/`), o que garante que o contrato commitado é sempre o do código. O CI também publica
  os dois arquivos como artefato.
- **Rationale**: o front gera o cliente sem depender do CI nem de a API estar rodando. O arquivo versionado também
  deixa mudanças de contrato visíveis no diff do pull request.
- **Risco**: se o modo preview não registrar as rotas para o Swagger, o script sobe o app completo contra o
  Postgres do compose. A primeira tarefa da US9 confirma qual caminho funciona.
- **Alternatives considered**:
  - Um único `openapi.json` separado só por tags: o `ng-openapi-gen` geraria um cliente único com as duas áreas,
    e os tipos do backoffice iriam para o portal.
  - Dois `SwaggerModule.createDocument` com `include`: o filtro do `include` é por módulo, não por área, e um
    mesmo módulo (ex.: messages) tem rotas públicas e administrativas.

## R10. Convenções de rota (TRV-07)

- **Decision**: decorators `@PublicApi('recurso')` e `@AdminApi('recurso')` que aplicam o prefixo, a tag do OpenAPI e
  metadados. Rotas públicas recebem também um interceptor que define `Cache-Control: no-store` e remove qualquer
  `Set-Cookie`. O teste de convenção usa o `DiscoveryService` para listar os controllers com metadado público e
  falha se encontrar parâmetro de caminho diferente de `:attachmentId` com validação de UUID.
- **Rationale**: a regra fica verificável por teste (SC-003) em vez de depender de revisão.

## R11. Referência de proxy (TRV-12)

- **Decision**: nginx como referência (`docs/deploy/nginx/canal-denuncias.conf` + `docs/deploy/proxy.md`), com
  `access_log off` e `proxy_set_header X-Forwarded-For ""` em `/api/public/`, log com IP só em `/api/admin/`,
  `ssl_protocols TLSv1.2 TLSv1.3`, HSTS e `client_max_body_size` igual ao tamanho máximo de anexo.
- **Rationale**: o nginx já é usado no front, então o time opera uma única tecnologia de proxy.
- **Alternatives considered**: Traefik. Equivalente, mas seria uma segunda tecnologia.
