---
description: 'Lista de tarefas da feature 002: criptografia em envelope'
---

# Tasks: Criptografia em envelope dos dados sensíveis

**Input**: Design documents from `specs/002-envelope-encryption/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are MANDATORY for every privacy, security, permission, encryption or audit rule (constitution,
principle VII). Nesta feature, praticamente toda história é regra de criptografia: os testes de cada uma vêm antes da
implementação e precisam falhar primeiro. Nos testes de "não vazou", usar também textos curtos (ex.: `XQZ`).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- API em projeto único: `src/` e `test/` na raiz do repositório.
- Testes unitários ao lado do código (`*.spec.ts`); integração em `test/` (`*.e2e-spec.ts`), com o harness da 001
  (`createTestApp`, banco clonado por suíte, `log-capture`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: decisões registradas, Node fixado e Vault local com o perfil de manutenção.

- [x] T001 Registrar as decisões D40 a D44 (tabela "Decisões para o registro" de `research.md`) em `docs/adr/README.md`,
      depois da D39, sem alterar linhas existentes
- [x] T002 [P] Adicionar ao repositório o `.tool-versions` (`nodejs 26.13.1`, decisão Q-P1) e citar o Node 26.13.1 e o
      `asdf install` na seção "Rodando localmente" de `README.md`
- [x] T003 Criar `docker/vault/maintenance-dev-policy.hcl` (rewrap na `report-kek` e `read` em `transit/keys/report-kek`),
      tirar o `rewrap` de `docker/vault/api-dev-policy.hcl` e fazer `docker/vault/init-transit.sh` criar o AppRole
      `maintenance` com IDs fixos de desenvolvimento (`dev-maintenance-role-id`, `dev-maintenance-secret-id`); montar a
      nova política no serviço `vault-init` de `docker-compose.yml`. Conferir que o script continua idempotente (3
      execuções seguidas)
- [x] T004 [P] Montar `docker/vault/maintenance-dev-policy.hcl` no passo de preparação do Vault do job e2e em
      `.github/workflows/ci.yml`
- [x] T005 [P] Documentar as credenciais de manutenção de desenvolvimento (só para o comando `rewrap-keys` e os testes)
      em `.env.example` e em `specs/001-transversal-infrastructure/contracts/environment.md`

**Checkpoint**: Vault local com AppRoles `api` (sem rewrap) e `maintenance`; Node 26.13.1 fixado.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: erros, contexto de cifragem e extensão do `KeyService`, usados por todas as histórias.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

### Tests (escritos antes, falhando)

- [x] T006 [P] Testes de `src/modules/crypto/crypto.errors.spec.ts`: cada erro (`DecryptionFailedError`,
      `UnsupportedFormatError`, `ContentSchemaError`, `ContentUnavailableError`) tem mensagem fixa, não tem `cause` e,
      serializado (`JSON.stringify` e `util.inspect`), não contém o texto, a chave nem o valor usados ao criá-lo
      (testar com `XQZ` e com texto longo)
- [x] T007 [P] Testes de `src/modules/crypto/encryption-context.spec.ts`: contexto `"<tabela>.<campo>:<id>"` em UTF-8 para
      cada coluna da lista de `contracts/crypto-module.md`; chave composta `":<id1>.<id2>"` para
      `report_access_blocks.reason_enc`; id que não é UUID, quantidade errada de ids e coluna fora da lista falham
- [x] T008 [P] Testes da extensão do `KeyService` em `src/infra/vault/vault.client.spec.ts`: `encrypt`/`decrypt` enviam
      `associated_data` em base64 quando informado e não enviam quando ausente; `latestVersion` faz `GET
transit/keys/:kek` e devolve `latest_version`; a `identity-kek` continua recusada antes da rede; nenhum erro
      carrega o `associated_data`

### Implementation

- [x] T009 [P] Implementar `src/modules/crypto/crypto.errors.ts` (R9, `contracts/crypto-module.md`)
- [x] T010 [P] Implementar `src/modules/crypto/encryption-context.ts` com a lista tipada `EncryptedColumn` e
      `encryptionContext()` (R1)
- [x] T011 Implementar a extensão em `src/infra/vault/key-service.ts`, `src/infra/vault/vault.client.ts` e, se preciso
      para o GET, `src/infra/vault/vault-http.ts` (`contracts/key-service-v2.md`); atualizar a fixture
      `test/support/fixtures/key-service-fixture.module.ts` se ela implementa a interface
- [x] T012 Fazer `src/modules/crypto/crypto.module.ts` importar o `VaultModule` e preparar os exports da interface de
      `contracts/crypto-module.md` (os serviços entram em cada história)

**Checkpoint**: base pronta; as histórias podem começar.

---

## Phase 3: User Story 1 - Campo cifrado que não pode ser lido nem trocado (Priority: P1) 🎯 MVP

**Goal**: formato v1 do campo cifrado com contexto obrigatório (CRYPTO-01).

**Independent Test**: cifrar e decifrar; abrir com contexto de outro registro, com byte alterado, com tag alterada e
com versão desconhecida.

### Tests for User Story 1 (mandatory for security and privacy rules) ⚠️

- [x] T013 [P] [US1] Testes de `src/modules/crypto/field-cipher.spec.ts`: ida e volta; contexto de outro id, campo ou
      tabela falha; alterar um byte do nonce, do ciphertext ou da tag falha; versão `0x02` e valor com menos de 29 bytes
      geram `UnsupportedFormatError`; chave diferente falha; texto vazio abre como vazio; dois cifrados do mesmo texto
      diferem; um valor no formato gravado pelas factories da 001 abre (compatibilidade)

### Implementation for User Story 1

- [x] T014 [US1] Implementar `sealField`/`openField` em `src/modules/crypto/field-cipher.ts`
      (`contracts/field-format.md`), sem repassar o erro do OpenSSL

**Checkpoint**: US1 verde e independente.

---

## Phase 4: User Story 2 - Uma chave por denúncia, que só existe em claro durante o uso (Priority: P1)

**Goal**: `DataKeyService` com zeragem e regra de nada de Vault dentro de transação (CRYPTO-02).

**Independent Test**: criar e abrir uma chave, conferir que o buffer foi zerado com sucesso e com erro, e que nenhuma
chamada ao Vault acontece com transação aberta.

### Tests for User Story 2 (mandatory for security and privacy rules) ⚠️

- [x] T015 [P] [US2] Testes unitários de `src/modules/crypto/data-key.service.spec.ts` com `KeyService` falso: a DEK
      entregue a `fn` é zerada depois de `fn` terminar e depois de `fn` lançar erro; o buffer intermediário também é
      zerado; o buffer entregue não é do pool compartilhado (`byteOffset === 0` e `buffer.byteLength === 32`);
      `withReportKey(null, fn)` gera `ContentUnavailableError` sem chamar o Vault; só a `report-kek` é usada
- [x] T016 [P] [US2] Testes de integração em `test/crypto/data-key.e2e-spec.ts` contra o Vault local, **autenticados com o
      AppRole `api` de desenvolvimento** (o token root só para tarefas administrativas do teste): criar, guardar o
      `wrapped` e abrir de novo; uma operação que cifra e grava no banco não chama o Vault com transação aberta (espiar
      as chamadas ao Vault e o estado da transação); Vault inacessível gera `KeyServiceUnavailableError` com mensagem
      fixa e sem dado sensível no log; uma `wrapped_dek` corrompida (e uma de outra KEK) gera erro genérico, e nem a
      mensagem nem o log contêm o valor guardado

### Implementation for User Story 2

- [x] T017 [US2] Implementar `createReportKey`/`withReportKey` em `src/modules/crypto/data-key.service.ts` (R2), com
      comentário sobre os limites da zeragem em Node, e registrar/exportar no `CryptoModule`

**Checkpoint**: US2 verde.

---

## Phase 5: User Story 3 - Selar e abrir registros de um jeito só (Priority: P1)

**Goal**: `RecordCipher` para JSON versionado e texto, e ids gerados pela aplicação (CRYPTO-03).

**Independent Test**: selar e abrir objeto e texto; abrir versão desconhecida; abrir mensagem com contexto de outra.

**Depends on**: US1 (formato) e US2 (chave de dados).

### Tests for User Story 3 (mandatory for security and privacy rules) ⚠️

- [x] T018 [P] [US3] Testes de `src/modules/crypto/record-cipher.service.spec.ts`: `ReportContentV1` sela e abre igual;
      `v` fora do mapa gera erro; objeto com campo a mais ou faltando gera `ContentSchemaError` sem devolver parcial e
      sem as issues do zod na mensagem; texto sela e abre; texto de uma mensagem não abre com o contexto de outra
- [x] T019 [P] [US3] Testes de `src/modules/crypto/record-id.spec.ts`: `newRecordId()` gera UUID v7 válido, ids gerados
      em sequência ordenam por tempo e o formato é aceito pelo cursor da 001 (`src/common/pagination/cursor.ts`)
- [x] T020 [P] [US3] Teste de integração de latência em `test/crypto/latency.e2e-spec.ts`, com o AppRole `api`: 50
      repetições de selar e abrir o conteúdo de uma denúncia, incluindo abrir a DEK no Vault local. Sempre escreve o p95
      medido no relatório do teste; **fora do CI** (`CI` não definido), falha se o p95 passar de 100 ms; no CI, só
      registra o valor (SC-003)

### Implementation for User Story 3

- [x] T021 [P] [US3] Acrescentar `ReportContentV1Schema` (zod, `strictObject`, helpers `text({ max })` de
      `src/common/validation/schemas.ts`; `dataTypes` restrito a `PERSONAL`, `FINANCIAL`, `CREDENTIALS` e `OTHER`, sem
      repetição, conforme o REP-02) em `src/modules/reports/report-content.ts`
- [x] T022 [P] [US3] Implementar `newRecordId()` em `src/modules/crypto/record-id.ts` com `crypto.randomUUIDv7()` (R8)
- [x] T023 [US3] Implementar `sealJson`/`openJson`/`sealText`/`openText` em `src/modules/crypto/record-cipher.service.ts`
      (R5) e registrar/exportar no `CryptoModule`

**Checkpoint**: US3 verde; os módulos do MVP já têm a interface que vão usar.

---

## Phase 6: User Story 4 - Segredos da aplicação cifrados no serviço de chaves (Priority: P1)

**Goal**: `AppSecretService` com `app-kek` e contexto do registro (CRYPTO-05).

**Independent Test**: cifrar e decifrar um segredo; abrir com o contexto de outro usuário.

**Depends on**: fase 2 (extensão do `KeyService`).

### Tests for User Story 4 (mandatory for security and privacy rules) ⚠️

- [x] T024 [P] [US4] Testes de integração em `test/crypto/app-secret.e2e-spec.ts` contra o Vault local, com o AppRole
      `api`: ida e volta; o
      valor guardado (`vault:vN:...`) não contém o segredo; abrir com o contexto de outro usuário falha com erro de
      mensagem fixa; nenhuma linha de log contém o segredo (`XQZ` e longo)

### Implementation for User Story 4

- [x] T025 [US4] Implementar `seal`/`open` em `src/modules/crypto/app-secret.service.ts` (R6) e registrar/exportar no
      `CryptoModule`

**Checkpoint**: US4 verde; o cadastro de MFA (AUTH) pode usar.

---

## Phase 7: User Story 5 - Nenhum segredo vaza em erro ou log (Priority: P1)

**Goal**: provar o não vazamento ponta a ponta e trocar as factories pela camada oficial (CRYPTO-08, pendência I3).

**Independent Test**: forçar cada falha com texto curto e longo e procurar o texto na resposta e no log.

**Depends on**: US2 e US3.

### Tests for User Story 5 (mandatory for security and privacy rules) ⚠️

- [x] T026 [P] [US5] Testes de integração em `test/crypto/no-leak.e2e-spec.ts`, por uma rota de fixture e com o AppRole
      `api`: contexto errado, valor adulterado, versão desconhecida, JSON fora do schema, `wrapped_dek` corrompida e
      Vault inacessível. Para cada caso, com relato
      `XQZ` e com relato longo, a resposta e as linhas de log da requisição não contêm o texto, a DEK (base64 e hex) nem
      o valor cifrado (base64 e hex)
- [x] T027 [P] [US5] Atualizar `test/support/factories.e2e-spec.ts`: a denúncia criada por `createEncryptedReport` abre
      pelo `DataKeyService` + `RecordCipher`, e `test/support/factories.ts` não usa mais `createCipheriv`

### Implementation for User Story 5

- [x] T028 [US5] Criar a rota de fixture em `test/support/fixtures/crypto-fixture.module.ts` (abre uma denúncia gravada
      e provoca as falhas sob demanda)
- [x] T029 [US5] Trocar `encryptField`/`decryptField` de `test/support/factories.ts` pelo `DataKeyService`, pelo
      `RecordCipher` e pelo `newRecordId()` (R11) e marcar a pendência I3 como resolvida em
      `specs/001-transversal-infrastructure/tasks.md`

**Checkpoint**: todas as histórias P1 verdes; o MVP da criptografia está completo.

---

## Phase 8: User Story 6 - Arquivos cifrados em streaming (Priority: P2)

**Goal**: formato STREAM v1 com sha256 do cifrado (CRYPTO-04).

**Independent Test**: arquivo de 10 MB com memória estável; arquivo cortado, alterado ou reordenado falha.

**Depends on**: fase 2.

### Tests for User Story 6 (mandatory for security and privacy rules) ⚠️

- [x] T030 [P] [US6] Testes de `src/modules/crypto/stream-cipher.spec.ts`: ida e volta com 0 byte, 1 byte, exatamente
      64 KiB, 64 KiB + 1 e 10 MB; corte no fim de um bloco e no meio de um bloco falham; dois blocos trocados falham;
      cabeçalho alterado falha; contexto de outro anexo falha; byte alterado falha; o sha256 informado é o dos bytes
      cifrados emitidos; com 10 MB gerados aos pedaços, o crescimento de memória (`heapUsed` + `arrayBuffers`) fica
      abaixo de 5 MB (SC-004); a falha é emitida como `DecryptionFailedError` sem texto em claro na mensagem

### Implementation for User Story 6

- [x] T031 [US6] Implementar `createEncryptStream`/`createDecryptStream` em `src/modules/crypto/stream-cipher.ts`
      (`contracts/stream-format.md`, R4) e exportar no `CryptoModule`

**Checkpoint**: US6 verde; a feature attachments pode usar.

---

## Phase 9: User Story 7 - Rotação de chaves sem tocar no conteúdo (Priority: P2)

**Goal**: recifragem retomável e auditada, com o perfil de manutenção (CRYPTO-06).

**Independent Test**: girar a `report-kek`, recifrar, conferir versões, conteúdo intacto e auditoria.

**Depends on**: US2, US5 (factories com a camada oficial) e Setup T003 (AppRole `maintenance`).

### Tests for User Story 7 (mandatory for security and privacy rules) ⚠️

- [x] T032 [P] [US7] Testes de integração em `test/crypto/rewrap.e2e-spec.ts`: criar denúncias, girar a chave com o token
      root de desenvolvimento e recifrar com a credencial `maintenance`; todas passam para `vault:v<latest>:` e continuam
      abrindo; `content_enc` fica byte a byte igual; uma segunda execução não recifra nada; uma execução interrompida
      depois do primeiro lote termina na seguinte; uma linha alterada no meio da execução é contada como ignorada; cada
      lote grava um `KEYS_REWRAPPED` na mesma transação dos seus `UPDATE`s (uma falha forçada na gravação do lote
      desfaz os `UPDATE`s e o registro juntos); cada execução grava um `KEYS_REWRAP_RUN`; todos com ator `SYSTEM`, sem
      IP, KEK em `resource_id` e metadata só com números; com a credencial da API, a operação falha e o resumo grava
      `FAILURE`
- [x] T033 [P] [US7] Testes do comando em `test/cli/rewrap-keys.e2e-spec.ts`: saídas e códigos de
      `contracts/cli-rewrap-keys.md`; `--kek identity-kek` e `--batch-size` fora do intervalo são recusados; o stdout
      nunca contém valor de `wrapped_dek`, chave ou id de denúncia

### Implementation for User Story 7

- [x] T034 [US7] Implementar a recifragem em lotes em `src/modules/crypto/rewrap.service.ts` (R7): versão atual,
      filtro por prefixo, rewrap do lote fora de transação, depois uma transação por lote com os `UPDATE ... WHERE id AND
wrapped_dek = antigo` (conferindo `affected`) e o `KEYS_REWRAPPED` do lote pelo `EntityManager` dela, e o
      `KEYS_REWRAP_RUN` no `finally`
- [x] T035 [US7] Implementar `src/cli/rewrap-keys.command.ts` (zod para as opções, SIGINT/SIGTERM encerram depois do lote
      atual) e registrá-lo em `src/cli/cli-commands.module.ts`, importando o `CryptoModule`

**Checkpoint**: US7 verde.

---

## Phase 10: User Story 8 - Acesso mínimo ao serviço de chaves em produção (Priority: P3)

**Goal**: políticas de produção testadas e passo a passo de operação (CRYPTO-07).

**Independent Test**: aplicar as políticas ao Vault local e conferir cada permissão e cada recusa.

**Depends on**: Setup T003.

### Tests for User Story 8 (mandatory for security and privacy rules) ⚠️

- [x] T036 [P] [US8] Testes de integração em `test/crypto/vault-policies.e2e-spec.ts`: com o token root de
      desenvolvimento, gravar as políticas de `docs/deploy/vault/policies/` com nomes de teste, criar um token por
      política e conferir cada célula de `contracts/vault-policies.md` (200 ou 403); conferir também que
      `docker/vault/api-dev-policy.hcl` e `docker/vault/maintenance-dev-policy.hcl` concedem exatamente o mesmo que as
      políticas de produção correspondentes (SC-006)

### Implementation for User Story 8

- [x] T037 [P] [US8] Criar `docs/deploy/vault/policies/api.hcl`, `maintenance.hcl` e `identity-worker.hcl`
- [x] T038 [US8] Escrever `docs/deploy/vault/README.md`: inicialização com 5 partes e quórum de 3, raft, snapshots de
      backup, audit device em arquivo, entrega dos `secret_id` por segredo, container da API sem core dump, sem
      `--inspect` e sem heap snapshot, e como rodar o `rewrap-keys` com o perfil de manutenção

**Checkpoint**: todas as histórias verdes.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [x] T039 [P] Atualizar `AGENTS.md`: conteúdo sensível só pelo `CryptoModule`; ids de registros cifrados com
      `newRecordId()`; `createReportKey`/`withReportKey` sempre antes da transação; recifragem só com o perfil de
      manutenção
- [x] T040 [P] Atualizar `README.md` (biblioteca de criptografia, comando `rewrap-keys`) e acrescentar uma referência a
      `specs/002-envelope-encryption/contracts/key-service-v2.md` em
      `specs/001-transversal-infrastructure/contracts/key-service.md`
- [x] T041 [P] Marcar os critérios de aceite atendidos em `docs/tarefas/01-crypto.md`, com nota sobre a `identity-kek` no
      CRYPTO-02 e no CRYPTO-06 (ficam com o IDV-06, D24)
- [x] T042 Incluir `src/modules/crypto` na cobertura de `vitest.config.coverage.ts` com limite de 80% e conferir com
      `npm run test:cov:all` (SC-007)
- [x] T043 Rodar o `quickstart.md` inteiro, inclusive o passo 4 manual, e o compose `--profile app` (API saudável com a
      política sem `rewrap`); depois Trivy e gitleaks
- [x] T044 Verificação final: lint, typecheck, formatação, testes unitários, e2e, build e `openapi:export` sem diferença

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (fase 1)**: sem dependências. T001 vem antes de qualquer código (princípio IX).
- **Foundational (fase 2)**: depende do Setup e bloqueia todas as histórias.
- **User stories**:
  - US1 (formato), US2 (chave de dados), US4 (segredos), US6 (streaming) e US8 (políticas) só dependem da fase 2.
  - US3 (registros) depende de **US1** e **US2**.
  - US5 (não vazamento e factories) depende de **US2** e **US3**.
  - US7 (recifragem) depende de **US2** e **US5**.
- **Polish (fase 11)**: depois das histórias.

### User Story Dependencies

```text
Fase 2 ──┬── US1 (formato) ──┐
         ├── US2 (DEK) ──────┼── US3 (registros) ── US5 (não vazamento, factories) ── US7 (recifragem)
         │                   │                                                      ▲
         │                   └──────────────────────────────────────────────────────┘ (US7 também depende de US2)
         ├── US4 (segredos da aplicação)
         ├── US6 (streaming)
         └── US8 (políticas)
```

### Within Each User Story

- Testes escritos primeiro e falhando antes da implementação.
- Erros e contexto (fase 2) antes dos serviços; serviços antes do registro no `CryptoModule`.
- A história fecha no seu checkpoint antes da próxima.

### Parallel Opportunities

- Setup: T002, T004 e T005 (T003 antes de T004).
- Fase 2: T006, T007 e T008 juntos; depois T009 e T010 juntos.
- Depois da fase 2: US1, US2, US4, US6 e US8 em paralelo. US3 quando US1 e US2 terminarem.
- Em cada história, os testes marcados [P] juntos e as implementações [P] juntas (ex.: T021 e T022 na US3).

---

## Parallel Example: User Story 3

```bash
# Testes juntos (falhando primeiro):
Task: "T018 Testes de src/modules/crypto/record-cipher.service.spec.ts"
Task: "T019 Testes de src/modules/crypto/record-id.spec.ts"
Task: "T020 Teste de latência em test/crypto/latency.e2e-spec.ts"

# Depois, implementações independentes juntas:
Task: "T021 ReportContentV1Schema em src/modules/reports/report-content.ts"
Task: "T022 newRecordId() em src/modules/crypto/record-id.ts"
```

---

## Implementation Strategy

### MVP First

1. Fases 1 e 2.
2. US1, US2 e US3: com elas, os módulos do MVP (reports, messages, case-management) já conseguem gravar e ler
   conteúdo cifrado.
3. US4 (MFA do login) e US5 (provas de não vazamento e factories) fecham as P1.
4. **Parar e validar** pelos passos 1 a 3 do `quickstart.md`.

### Incremental Delivery

- P1 (US1 a US5): destrava reports, messages, case-management e auth.
- P2 (US6, US7): destrava attachments e a rotação antes da produção.
- P3 (US8): documentação e políticas de produção.

### Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- Cada fase concluída vira um commit local, com testes verdes.
- Nunca afrouxar uma regra para um teste passar: se um teste de não vazamento falhar, o código está errado.

---

## Pendências do analyze

| ID  | Situação  | Pendência                                                                                                                       | Onde resolver |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| G3  | Resolvido | Cobrir a queda do Vault no meio da recifragem: execução com `FAILURE` e nova execução terminando o serviço                      | T032          |
| I1  | Resolvido | O R7 do `research.md` dizia que a KEK ia na metadata; o data-model coloca em `resource_id`. Vale o data-model                   | T034          |
| U1  | Resolvido | Medição de memória do streaming estável: amostrar o pico e chamar `gc()` antes de medir (`--expose-gc`) ou medir `arrayBuffers` | T030          |
| U2  | Resolvido | Detalhar o mecanismo da T016 (ex.: `queryRunner.isTransactionActive` no momento da chamada) e conferir a fixture da T011        | T011, T016    |
| I2  | Resolvido | `EncryptedColumn` inclui `attachments.object`, que não é coluna: renomear para `EncryptedField` ou documentar a exceção         | T010          |
| I3  | Resolvido | O Prettier precisa de duas passadas no `tasks.md`: rodar duas vezes antes do commit da fase                                     | cada commit   |
