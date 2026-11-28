# Research: Criptografia em envelope dos dados sensíveis

Feature 002, tarefas CRYPTO-01 a CRYPTO-08. Todas as decisões abaixo usam só `node:crypto` e o Vault já integrado na
feature 001: **nenhuma dependência nova**. As decisões que entram no registro de decisões viram D40 a D44 (as D34 a
D39 são do front).

Verificações feitas contra o ambiente local nesta etapa:

- Node 26.13.1 (imagem `node:26-alpine` e, desde a Q-P1, também a máquina de desenvolvimento, via `.tool-versions`)
  tem `crypto.randomUUIDv7()`.
- Vault 2.2 do docker-compose: `transit/encrypt/app-kek` aceita `associated_data`; a decifragem com outro contexto ou
  sem contexto falha com `message authentication failed`.
- Vault 2.2: `transit/rewrap` na mesma versão da chave devolve um texto cifrado **novo** (não é operação neutra). A
  versão atual da chave é lida em `transit/keys/<kek>` (`latest_version`).

---

## R1. Formato do campo cifrado e contexto (CRYPTO-01)

- **Decision**: formato v1 da constituição, `[1 byte versão][12 bytes nonce][ciphertext][16 bytes tag]`, com
  `aes-256-gcm` do `node:crypto`, nonce de `randomBytes(12)` por cifragem. O contexto (AAD) é montado por um único
  helper a partir de uma lista tipada das colunas cifradas que existem no schema (`reports.content_enc`,
  `messages.body_enc`, `internal_notes.body_enc`, `report_status_history.justification_enc`,
  `report_access_blocks.reason_enc`, `identity_reveal_requests.justification_enc`, `attachments.original_name_enc`, mais
  `attachments.object` para os arquivos e `users.mfa_secret_enc` para o segredo de MFA) e do id do registro, que precisa ser um UUID. O resultado é `"<tabela>.<campo>:<id>"` em UTF-8.
- **Rationale**: o formato já é exigido pela constituição e usado pelas factories da 001, então não muda nada guardado.
  Uma lista tipada impede contexto digitado errado, que geraria dado impossível de abrir. Validar o UUID impede um
  contexto ambíguo.
- **Limite de uso da chave**: com nonce aleatório de 96 bits, o limite recomendado é 2³² cifragens por chave. Como
  cada denúncia tem a própria chave, o volume por chave fica na casa das dezenas ou centenas.
- **Alternatives considered**: AES-GCM-SIV ou XChaCha20-Poly1305, mais tolerantes a repetição de nonce. Rejeitados:
  exigiriam dependência nativa nova, e o risco de repetição é irrelevante com chave por denúncia.

## R2. Chave de dados em claro e zeragem da memória (CRYPTO-02)

- **Decision**: `DataKeyService.withReportKey(wrapped, fn)` abre a chave pelo `KeyService`, copia os 32 bytes para um
  `Buffer.alloc(32)` próprio (fora do pool compartilhado), zera o buffer intermediário, entrega a cópia a `fn` e faz
  `fill(0)` no `finally`, com sucesso ou com erro. `createReportKey(fn)` faz o mesmo na criação e devolve só o
  `wrapped`. Nenhuma outra forma de obter a chave em claro é exportada.
- **Limites conhecidos** (documentados no código e no `quickstart.md`):
  - A resposta do Vault chega como JSON, e a chave em base64 vive numa `string` do V8. Strings são imutáveis e não dá
    para zerá-las: ficam na memória até o coletor de lixo liberar. O mesmo vale para o corpo da resposta HTTP.
  - O `createCipheriv` copia a chave para o contexto nativo do OpenSSL, liberado quando o objeto é coletado.
  - Por isso a zeragem **reduz a janela de exposição**, mas não garante que a chave sumiu da memória. A proteção
    efetiva contra leitura de memória é operacional: sem core dump no container (`ulimit -c 0`), sem `--inspect` e
    sem heap snapshot em produção. Isso entra no passo a passo de produção (CRYPTO-07).
- **Rationale**: é o melhor possível em Node sem dependência nativa. Concentrar o acesso num único método evita que
  a chave escape para variáveis de vida longa.
- **Alternatives considered**: `crypto.createSecretKey` (`KeyObject`), que guarda a chave fora do heap JS. Rejeitado
  como solução: a chave continua passando por string na resposta do Vault, e o `KeyObject` não pode ser zerado.
  Pacotes de memória protegida (`sodium-native`): dependência nativa nova para um ganho parcial.

## R3. Cache de chaves de dados (CRYPTO-02, SC-003)

- **Decision**: **sem cache** nesta feature. Um teste de integração mede o tempo de selar e abrir o conteúdo de uma
  denúncia, incluindo a abertura da chave no Vault local, em 50 repetições, e falha se o p95 passar de 100 ms. O
  número medido fica registrado no relatório do teste.
- **Rationale**: o Vault local responde em poucos milissegundos, e um cache guardaria chaves em claro por mais tempo,
  o oposto do R2. A reavaliação acontece quando houver medição com carga real (listas da caixa de denúncias).
- **Alternatives considered**: cache em memória com TTL curto. Adiado: só faz sentido com evidência de latência.

## R4. Formato de arquivo cifrado em streaming (CRYPTO-04)

- **Decision**: construção **STREAM** (blocos autenticados, como no `age` e no Tink), versão 1:
  - Cabeçalho de 13 bytes: `[1 byte versão][4 bytes tamanho do bloco][8 bytes prefixo de nonce aleatório]`.
  - Blocos de 64 KiB de texto em claro. Cada bloco vira `ciphertext + tag de 16 bytes`, cifrado com AES-256-GCM.
  - Nonce do bloco `i` = prefixo (8 bytes) + `i` em uint32 big-endian (4 bytes).
  - AAD do bloco = contexto do anexo (`"attachments.object:<id>"`) + 1 byte de marcação de último bloco (`0x00` ou
    `0x01`). O cabeçalho entra na AAD do primeiro bloco.
  - O último bloco é sempre marcado, mesmo vazio. Na leitura, o decifrador segura um bloco de antecedência para saber
    qual é o último.
  - O sha256 do arquivo cifrado é calculado durante a escrita, por um `Transform` que só observa os bytes.
- **Rationale**: cada bloco é verificado antes de liberar o texto em claro, então nunca sai conteúdo não autenticado.
  A marcação do último bloco e o contador no nonce detectam corte, reordenação e remoção de blocos (FR-017). A memória
  usada é de um ou dois blocos, independente do tamanho do arquivo (SC-004). Limite: 2³² blocos (256 TiB).
- **Alternatives considered**: um único GCM sobre o arquivo inteiro, com a tag no fim. Rejeitado: o `Decipher` do
  Node libera texto em claro antes de verificar a tag, e um arquivo adulterado seria entregue em parte antes da falha.

## R5. Selar e abrir registros versionados (CRYPTO-03)

- **Decision**: `RecordCipher` com `sealJson(dek, ctx, value)`, `openJson(dek, ctx, schemas)`, `sealText(dek, ctx,
text)` e `openText(dek, ctx)`. O JSON selado sempre tem o campo `v`. Na abertura, `schemas` é um mapa
  `{ 1: ReportContentV1Schema }`: versão ausente no mapa ou objeto fora do schema geram erro, sem devolver nada
  parcial. O schema da versão 1 usa `z.strictObject` e os helpers de texto com limite, como toda entrada do projeto.
- **Rationale**: a validação na abertura protege contra dado gravado errado ou formato antigo esquecido, e o mapa por
  versão permite evoluir o conteúdo sem reescrever denúncias antigas.
- **Alternatives considered**: validar só na gravação. Rejeitado: a abertura é o último ponto antes de o dado chegar à
  tela.

## R6. Segredos da aplicação presos ao registro (CRYPTO-05)

- **Decision**: `AppSecretService.seal(ctx, secret)` e `open(ctx, value)` usam `transit/encrypt/app-kek` e
  `transit/decrypt/app-kek` com `associated_data` igual ao contexto do registro (`"users.mfa_secret_enc:<id>"`). Isso
  exige um parâmetro opcional `associatedData` em `KeyService.encrypt` e `KeyService.decrypt`, uma extensão compatível
  do contrato da feature 001 (`contracts/key-service.md`).
- **Rationale**: sem o contexto, quem pudesse escrever no banco conseguiria copiar o segredo de MFA de um usuário para
  outro. Com ele, o Vault recusa (verificado no Vault 2.2 local).
- **Alternatives considered**: cifrar o segredo localmente com uma chave de dados. Rejeitado: o backlog define
  cifragem direta pelo Vault para dado pequeno, e assim a chave nunca sai do Vault.

## R7. Rotação e recifragem retomável (CRYPTO-06)

- **Decision**:
  - Comando `npm run cli -- rewrap-keys --kek report-kek`, que roda com a credencial do **perfil de manutenção** (um
    AppRole separado, `maintenance`), nunca com a da API.
  - Antes de começar, lê a versão atual da chave (`transit/keys/report-kek`, campo `latest_version`).
  - Percorre `reports` por id crescente, em lotes de 200, só onde `wrapped_dek` não é nulo e não começa com
    `vault:v<latest>:`. Esse filtro torna a execução retomável e evita recifrar duas vezes, já que o rewrap na mesma
    versão gera um valor novo.
  - Para cada lote: primeiro recifra no Vault, **fora de transação** (nada de HTTP dentro de transação). Depois abre
    **uma** transação para o lote, com todos os `UPDATE ... SET wrapped_dek = $novo WHERE id = $id AND wrapped_dek =
$antigo` e um registro `KEYS_REWRAPPED` do lote, gravado com o `EntityManager` dessa transação. Assim cada escrita
    de chave protegida é auditada na mesma transação (princípio V). Se a linha mudou no meio do caminho
    (`affected = 0`), ela é contada como ignorada e entra numa próxima execução.
  - No fim, inclusive com erro ou interrupção, grava um `KEYS_REWRAP_RUN` (resumo da execução) com resultado
    `SUCCESS` ou `FAILURE`. A KEK vai em `resource_id` e a metadata só tem números (ver data-model).
- Exige mais um método no `KeyService`: `latestVersion(kek)`.
- **Rationale**: atende idempotência e retomada (FR-020) sem tabela de controle, usa a regra de nada de HTTP dentro de
  transação, audita cada lote na transação das suas escritas (princípio V) e não toca no conteúdo cifrado (FR-019).
- **Alternatives considered**: tabela de progresso da recifragem. Rejeitada: o prefixo de versão já é o estado.
  Recifragem pela API em produção. Rejeitada: a API não pode ter `rewrap` (CRYPTO-07).
- **Fora do escopo**: recifragem dos segredos da `app-kek` (`users.mfa_secret_enc`) e das chaves de identidade. A
  primeira não é pedida pela spec; depois de uma rotação, os valores antigos continuam abrindo enquanto a versão
  mínima de decifragem não for elevada. A segunda é do IDV-06.

## R8. Identificadores gerados pela aplicação (CRYPTO-03, FR-014)

- **Decision**: `newRecordId()` com o `crypto.randomUUIDv7()` nativo do Node 26, sem dependência nova. O default
  `uuidv7()` do banco continua como reserva. **Decidido pelo usuário (Q-P1, opção A, 2026-11-28)**: a máquina de
  desenvolvimento usa o Node 26.13.1, fixado por projeto no `.tool-versions` (`nodejs 26.13.1`).
- **Rationale**: o `package.json`, a imagem Docker e o CI já exigem Node 26. O formato é o mesmo do `uuidv7()` do
  Postgres 18, então a paginação por cursor (US6 da 001) continua funcionando.
- **Alternatives considered**:
  - Pacote `uuid@14.0.3` (`v7()`): funcionaria no Node 25 local, mas é uma dependência a mais para algo nativo.
  - `SELECT uuidv7()` antes de cada insert: uma ida ao banco a mais por registro, e as factories da 001 já fazem isso
    só porque não havia outra opção.

## R9. Erros de criptografia

- **Decision**: erros próprios com mensagem fixa e sem `cause`:
  - `DecryptionFailedError`: contexto errado, dado adulterado ou chave errada. Vira 500 genérico.
  - `UnsupportedFormatError`: versão desconhecida ou tamanho impossível. Vira 500 genérico.
  - `ContentSchemaError`: JSON aberto fora do schema da versão. Vira 500 genérico e não carrega as issues do zod.
  - `ContentUnavailableError`: chave de dados destruída pelo expurgo (`wrapped_dek` nulo). O módulo que usa decide a
    resposta HTTP (ex.: 410 no acompanhamento).
  - O erro original do OpenSSL nunca é repassado: só o tipo do erro próprio vai para o log.
- **Rationale**: o filtro global da 001 já esconde 500s, mas erros que nunca carregam o dado protegem também o log
  (FR-025, US5).

## R10. Políticas do Vault e perfis (CRYPTO-07)

- **Decision**:
  - `docs/deploy/vault/policies/`: `api.hcl` (datakey e decrypt na `report-kek`; encrypt e decrypt na `app-kek`; nada
    na `identity-kek`; sem rewrap), `maintenance.hcl` (rewrap na `report-kek` e leitura de `transit/keys/report-kek`)
    e `identity-worker.hcl` (`datakey` e `decrypt` na `identity-kek`, porque a identidade também usa envelope
    encryption; só documentada, já que o serviço é do IDV-06).
  - `docs/deploy/vault/README.md`: inicialização com 5 partes de chave e quórum de 3 (Shamir), armazenamento integrado
    (raft), snapshots de backup, audit device em arquivo, sem core dump e sem heap snapshot no container da API.
  - Ambiente local: a política `api-dev` perde o `rewrap` (paridade com produção), e o `init-transit.sh` cria o AppRole
    `maintenance` com IDs fixos de desenvolvimento.
  - Um teste de integração cria, com o token root de desenvolvimento, tokens com as políticas de produção e confere o
    que é permitido e o que é recusado (SC-006).
- **Rationale**: as políticas testadas são as mesmas documentadas para produção, e não uma cópia que pode divergir.

## R11. Factories de teste (pendência I3 da 001, FR-027)

- **Decision**: `createEncryptedReport` passa a usar o `DataKeyService` e o `RecordCipher`, e as funções
  `encryptField` e `decryptField` de `test/support/factories.ts` são removidas.
- **Rationale**: fecha a I3 e garante que os testes gravam exatamente o formato que os módulos vão ler.

## Decisões para o registro (`docs/adr/README.md`)

| #   | Tema                          | Decisão                                                                                           |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| D40 | Formato de arquivo cifrado    | STREAM com blocos de 64 KiB, nonce prefixo + contador, marcação de último bloco na AAD (R4)       |
| D41 | Cache de chaves de dados      | Sem cache. Reavaliar com medição real; meta de 100 ms no p95 (R3)                                 |
| D42 | Segredos da aplicação         | Cifrados no Vault com `associated_data` igual ao contexto do registro (R6)                        |
| D43 | Perfil de manutenção          | AppRole `maintenance` só para recifragem; a API não tem `rewrap` em nenhum ambiente (R7, R10)     |
| D44 | Identificadores dos registros | `crypto.randomUUIDv7()` nativo do Node 26, com Node 26.13.1 fixado no `.tool-versions` (R8, Q-P1) |
