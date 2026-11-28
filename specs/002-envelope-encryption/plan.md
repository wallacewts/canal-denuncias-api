# Implementation Plan: Criptografia em envelope dos dados sensíveis

**Branch**: `main` (sem branch de feature, decisão do usuário) | **Date**: 2026-11-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-envelope-encryption/spec.md`

## Summary

Entregar a camada de criptografia usada por todo módulo que guarda dado sensível, cobrindo as 8 tarefas de
`docs/tarefas/01-crypto.md` (CRYPTO-01 a CRYPTO-08):

- formato de campo cifrado v1 (AES-256-GCM, contexto `"<tabela>.<campo>:<id>"`) com um helper único de contexto;
- `DataKeyService`, que gera e abre a chave de dados de cada denúncia pelo `KeyService` da feature 001 e zera a
  chave em claro ao fim de cada uso;
- `RecordCipher`, que sela e abre JSON versionado (validado por schema da versão) e texto;
- cifragem de arquivos em streaming no formato STREAM (blocos de 64 KiB autenticados), com sha256 do cifrado;
- `AppSecretService`, para segredos pequenos cifrados no Vault com contexto do registro (segredo de MFA);
- comando `rewrap-keys`, retomável e auditado, rodando com um perfil de manutenção separado da API;
- políticas do Vault de produção, passo a passo de operação e teste que aplica as políticas e confere recusas;
- testes de não vazamento e a troca das factories de teste pela camada oficial (pendência I3 da feature 001).

Sem dependência nova, sem tabela nova e sem rota nova.

## Technical Context

**Language/Version**: TypeScript 6 sobre Node.js 26 LTS, ESM.

**Primary Dependencies**: as já instaladas. `node:crypto` (AES-256-GCM, `randomBytes`, `randomUUIDv7`, sha256),
o `KeyService` próprio do Vault (feature 001, D28), NestJS 12, TypeORM 1.1, zod 4.6.7, `nest-commander` 3.21.0.
**Nenhuma dependência nova.**

**Storage**: PostgreSQL 18, nas colunas `bytea` cifradas que já existem (ver [data-model.md](./data-model.md)). Vault
2.2 Transit para as chaves mestras. Storage S3 da feature 001 para os anexos cifrados (consumido pela feature
attachments; esta feature entrega só a cifragem em streaming).

**Testing**: Vitest. Unitários para formato, contexto, streaming e erros. Integração contra o Vault e o Postgres do
docker-compose, com banco clonado por suíte (harness da 001), para chaves de dados, segredos da aplicação, recifragem,
políticas e latência.

**Target Platform**: container Linux (imagem `node:26-alpine`), on-premise.

**Project Type**: web-service (API NestJS) com CLI administrativa.

**Performance Goals**: selar e abrir o conteúdo de uma denúncia, incluindo abrir a chave no Vault local, em até
100 ms no p95 (SC-003). Arquivo de 10 MB cifrado com crescimento de memória abaixo de 5 MB (SC-004).

**Constraints**:

- Nada de chamada ao Vault dentro de transação do banco.
- Chave em claro só dentro de `withReportKey`/`createReportKey`, zerada no `finally`.
- Nenhum erro carrega texto em claro, chave, texto cifrado ou valor protegido.
- A API nunca usa a `identity-kek` nem tem `rewrap`.

**Scale/Scope**: uma chave de dados por denúncia; dezenas a centenas de cifragens por chave; recifragem em lotes de 200.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Confira cada portão contra `.specify/memory/constitution.md`. Marque ✅ ou explique a violação em "Complexity Tracking".

- [x] I. Anonimato: nenhuma rota pública é criada ou alterada. A recifragem roda por CLI, com ator "sistema" e sem IP.
- [x] II. Minimização: nenhum dado novo é coletado. Os erros de criptografia têm mensagem fixa e sem causa (R9), e a
      metadata de `KEYS_REWRAPPED` só tem KEK, versão e contagens.
- [x] III. Criptografia: esta feature **é** a implementação do princípio III: envelope encryption com chave por
      denúncia, AES-256-GCM com AAD, chave em claro só em memória e zerada. A allowlist da 001 continua recusando a
      `identity-kek`, e as políticas tiram da API qualquer acesso a ela.
- [x] IV. Acesso: não há rota de negócio. O acesso ao Vault segue o mínimo necessário, com `rewrap` só no perfil de
      manutenção (R10).
- [x] V. Auditoria: a única escrita com efeito sobre dado sensível é a recifragem: cada lote grava os `UPDATE`s e um
      `KEYS_REWRAPPED` na **mesma transação** (`AuditService.record()` com o `EntityManager` do lote), e um
      `KEYS_REWRAP_RUN` resume a execução. As chamadas ao Vault ficam fora dessas transações. As gravações de conteúdo cifrado são auditadas pelos módulos que as fazem.
- [x] VI. Banco: nenhuma migration, porque as colunas já existem. A recifragem usa `UPDATE ... WHERE id AND
wrapped_dek = antigo` e confere `affected`, sem ler e depois salvar.
- [x] VII. Testes: cada regra (contexto, adulteração, versão, zeragem, recusa da `identity-kek`, políticas, não
      vazamento com textos curtos e longos) tem teste escrito antes. A cobertura do módulo fica em pelo menos 80%.
- [x] VIII. Qualidade: stack fixa e sem dependência nova. As credenciais de manutenção do ambiente local são fictícias
      e de desenvolvimento, como as da API.
- [x] IX. Simplicidade: só as 8 tarefas pedidas. A recifragem da `app-kek` e a das chaves de identidade ficam de fora
      (R7). As decisões D40 a D44 entram em `docs/adr/README.md` como primeira tarefa.

**Re-check após o design (Phase 1)**: todos os portões continuam ✅. O design acrescenta dois métodos opcionais ao
contrato do `KeyService` da 001 (`associatedData` em `encrypt`/`decrypt` e `latestVersion`), uma extensão
compatível que não exige justificativa. Nenhuma violação a registrar.

## Decisões do usuário

- **Q-P1 (2026-11-28)**: identificadores gerados com o `crypto.randomUUIDv7()` nativo do Node 26 (opção A). A máquina
  de desenvolvimento passou para o Node 26.13.1 (asdf), fixado por projeto num `.tool-versions` com `nodejs 26.13.1`,
  que entra no commit da fase Setup. O npm local (11.20.0) passa a ser o mesmo da imagem `node:26-alpine`, então o
  lockfile deixa de divergir.

## Project Structure

### Documentation (this feature)

```text
specs/002-envelope-encryption/
├── plan.md              # Este arquivo
├── research.md          # Decisões R1 a R11
├── data-model.md        # Colunas cifradas, formatos e estados
├── quickstart.md        # Cenários de validação
├── contracts/
│   ├── crypto-module.md     # Interface que o CryptoModule exporta
│   ├── field-format.md      # Formato do campo cifrado v1 e do contexto
│   ├── stream-format.md     # Formato STREAM v1 dos arquivos
│   ├── key-service-v2.md    # Extensão do contrato do KeyService da 001
│   ├── cli-rewrap-keys.md   # Comando de recifragem
│   └── vault-policies.md    # Políticas e perfis do Vault
├── checklists/
│   └── requirements.md
└── tasks.md             # Gerado por /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── modules/crypto/
│   ├── crypto.module.ts            # exporta DataKeyService, RecordCipher, AppSecretService (já existe, vazio)
│   ├── encryption-context.ts       # lista tipada das colunas cifradas e helper do contexto (CRYPTO-01)
│   ├── field-cipher.ts             # sealField/openField, formato v1 (CRYPTO-01)
│   ├── crypto.errors.ts            # erros de mensagem fixa (R9)
│   ├── data-key.service.ts         # createReportKey/withReportKey, zeragem (CRYPTO-02)
│   ├── record-cipher.service.ts    # sealJson/openJson/sealText/openText (CRYPTO-03)
│   ├── record-id.ts                # newRecordId() (R8)
│   ├── stream-cipher.ts            # encrypt/decrypt em streaming e sha256 (CRYPTO-04)
│   ├── app-secret.service.ts       # seal/open com app-kek e associated_data (CRYPTO-05)
│   └── rewrap.service.ts           # recifragem em lotes (CRYPTO-06)
├── modules/reports/report-content.ts  # ganha o schema zod ReportContentV1Schema
├── infra/vault/
│   ├── key-service.ts              # + associatedData opcional, + latestVersion (extensão)
│   └── vault.client.ts             # implementa a extensão
└── cli/
    ├── cli-commands.module.ts      # registra o novo comando
    └── rewrap-keys.command.ts      # npm run cli -- rewrap-keys --kek report-kek (CRYPTO-06)

docker/vault/
├── api-dev-policy.hcl              # perde o rewrap
├── maintenance-dev-policy.hcl      # novo
└── init-transit.sh                 # cria o AppRole maintenance

docs/deploy/vault/                  # CRYPTO-07
├── README.md                       # inicialização, Shamir, backup, audit device, sem core dump
└── policies/
    ├── api.hcl
    ├── maintenance.hcl
    └── identity-worker.hcl

test/
├── crypto/
│   ├── data-key.e2e-spec.ts        # Vault real, zeragem, nada de HTTP em transação
│   ├── app-secret.e2e-spec.ts      # associated_data
│   ├── rewrap.e2e-spec.ts          # rotação, retomada, auditoria
│   ├── vault-policies.e2e-spec.ts  # políticas de produção aplicadas ao Vault local
│   ├── latency.e2e-spec.ts         # p95 de selar e abrir (SC-003)
│   └── no-leak.e2e-spec.ts         # falhas forçadas, resposta e log (CRYPTO-08)
└── support/factories.ts            # passa a usar a camada oficial (I3)
```

Os testes unitários ficam ao lado do código (`*.spec.ts`), como no restante do projeto: `encryption-context.spec.ts`,
`field-cipher.spec.ts`, `record-cipher.service.spec.ts`, `stream-cipher.spec.ts` (inclui o arquivo de 10 MB) e
`crypto.errors.spec.ts`.

**Structure Decision**: o código de criptografia fica em `src/modules/crypto/`, módulo que já existe e está vazio. O
acesso ao Vault continua em `src/infra/vault/` (feature 001). O backlog cita `src/modules/crypto/key-service.ts` para a
CRYPTO-02, mas esse nome já é usado pelo `KeyService` da infraestrutura; por isso o serviço desta feature se chama
`data-key.service.ts`.

## Complexity Tracking

Nenhuma violação da constituição a justificar.
