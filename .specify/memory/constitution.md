<!--
Sync Impact Report
- Versão: 1.0.0 → 1.1.0 (MINOR: regra do princípio V ampliada com a exceção de retenção da trilha)
- Princípios modificados:
  V. Auditoria imutável (título mantido): a trilha continua append-only; passa a admitir uma única remoção, a de
  partições inteiras depois do prazo de guarda (D49), por função restrita ao perfil de manutenção (D50), com âncora
  conferida pela verificação da cadeia (D51)
- Seções adicionadas: nenhuma
- Seções removidas: nenhuma
- Templates:
  ✅ .specify/templates/plan-template.md (portão V cita a exceção de retenção)
  ✅ .specify/templates/tasks-template.md (sem mudança: testes já obrigatórios para regras de auditoria)
  ✅ .specify/templates/spec-template.md (sem mudança)
  ✅ .specify/templates/checklist-template.md (sem mudança)
- TODOs adiados: nenhum
- Histórico: 1.0.0 (2026-11-27) primeira ratificação
-->

# Constituição da API do Canal de Denúncias

API do sistema de denúncias de vazamento de dados. Recebe denúncias anônimas de colaboradores, parceiros e
terceiros e precisa ser ela mesma um exemplo de conformidade com a LGPD. As decisões de arquitetura que
fundamentam estes princípios estão em `docs/adr/README.md` (D01 a D52) e o backlog em `docs/tarefas/`.

## Core Principles

### I. Anonimato do denunciante (inegociável)

- Rotas públicas (`/api/public/v1/*`) NÃO DEVEM registrar IP, user-agent, cabeçalhos ou fingerprint em logs,
  auditoria ou banco.
- Protocolo, chave e dados pessoais NÃO DEVEM ir no caminho nem na query string da URL. Vão só no corpo da
  requisição.
- O denunciante NÃO DEVE ter conta. O acesso DEVE ser por protocolo + chave, e só o hash argon2id da chave é
  guardado.
- Para o denunciante, a equipe DEVE aparecer só como "Equipe de apuração". Nomes de analistas nunca são expostos.

**Justificativa:** a proteção contra retaliação depende de não existir nenhum rastro técnico que ligue a denúncia
a uma pessoa. Um único log com IP anula todo o resto.

### II. Minimização e finalidade (LGPD)

- O sistema DEVE coletar só o necessário para apurar a denúncia. Fica em claro só o que alimenta filtro, SLA ou
  estatística e não descreve pessoas nem fatos.
- Conteúdo de denúncia NÃO DEVE aparecer em logs, em `audit_logs.metadata`, em mensagens de erro nem em respostas
  que não precisem dele.
- Nenhuma telemetria, analytics ou log DEVE sair para serviços externos.
- Dados DEVEM ser usados só para tratar o incidente relatado.

**Justificativa:** princípios de necessidade e finalidade da LGPD (art. 6º). Dado que não existe não vaza.

### III. Criptografia por padrão

- Relato, mensagens, notas, justificativas, nomes de anexos e identidade DEVEM ser cifrados com envelope
  encryption: uma DEK por denúncia, AES-256-GCM com AAD `"<tabela>.<campo>:<id>"`, KEKs no Vault Transit
  (`report-kek`, `identity-kek`, `app-kek`).
- A DEK decifrada DEVE existir só em memória, durante a requisição.
- A API NÃO DEVE ter acesso à `identity-kek`. Só o `identity-worker` isolado cifra e decifra identidades.
- NÃO DEVE haver criptografia caseira: usar `node:crypto` e o Vault.

**Justificativa:** um vazamento do banco ou dos backups não pode expor denúncias. O isolamento da identidade
garante que invadir a API não basta para descobrir quem denunciou.

### IV. Acesso mínimo e negado por padrão

- Toda rota administrativa DEVE declarar a permissão que exige. Rota sem permissão declarada DEVE ser negada.
- O escopo DEVE ser aplicado no `WHERE` da consulta (atribuição e conflito de interesse), nunca filtrando depois
  de carregar.
- A revelação de identidade DEVE exigir justificativa e aprovação de outra pessoa (four-eyes), validada também
  no banco.
- Ninguém DEVE alterar os próprios perfis.

**Justificativa:** cada perfil vê só o que precisa para trabalhar. Filtrar depois de carregar abre espaço para
vazamento por erro de código.

### V. Auditoria imutável

- Toda leitura e escrita de dado sensível DEVE gerar registro em `audit_logs` pelo `AuditService`, na mesma
  transação da operação.
- `audit_logs` é append-only, com cadeia de hash e advisory lock. Nenhum código DEVE fazer `UPDATE` ou `DELETE`
  nessa tabela.
- A única remoção permitida é a de partições inteiras após o prazo de guarda da trilha (D49), por função restrita ao
  perfil de manutenção, nunca pela API (D50), registrada na mesma transação e com âncora conferida pela verificação da
  cadeia (D51). Nenhum outro mecanismo DEVE remover registros da trilha.

**Justificativa:** a trilha precisa provar quem acessou o quê e quando, inclusive contra quem administra o
sistema. A remoção por partição cumpre o prazo de guarda da LGPD sem desligar a imutabilidade, e a âncora impede que
o mecanismo seja usado para apagar registros recentes.

### VI. Banco de dados como última linha de defesa

- Regras críticas DEVEM existir também como `CHECK`, FK ou `UNIQUE` no banco.
- `synchronize` do TypeORM DEVE ficar sempre desligado. Toda mudança de schema é uma migration revisada, com
  `down()` funcional. Duplicações de enum geradas pelo TypeORM DEVEM ser removidas antes do commit.
- Toda entidade nova DEVE entrar em `src/database/entities.ts`. Relações DEVEM usar `Relation<T>`.
- A API DEVE rodar com o perfil `app_runtime`. As migrations rodam com `app_migrator`.
- Atualizações DEVEM usar `update()` com `WHERE` e conferir `affected`, nunca ler e depois `save()`. Violações de
  constraint DEVEM virar 409, não 500.

**Justificativa:** um bug na aplicação não pode resultar em dado inconsistente ou em regra de segurança violada.

### VII. Testes primeiro nas regras de segurança

- Toda regra de privacidade, permissão, criptografia ou auditoria DEVE ter teste automatizado que falha se a regra
  for quebrada (ex.: rota pública com `X-Forwarded-For` gera auditoria sem IP).
- Esses testes DEVEM ser escritos antes da implementação e falhar primeiro.
- A cobertura do domínio DEVE ser de no mínimo 80%. Testes de integração DEVEM usar Postgres real.
- Vitest para testes unitários e e2e.

**Justificativa:** regras de segurança costumam quebrar em silêncio. Só um teste que falha mostra a regressão.

### VIII. Qualidade e entrega

- A stack é fixa: Node.js 26, NestJS 12 (ESM, imports relativos com `.js`), TypeORM 1.x, PostgreSQL 18. Pacote
  oficial do Nest DEVE ser avaliado antes de biblioteca de terceiros.
- Commits DEVEM seguir Conventional Commits. Lint (oxlint), typecheck, formatação e testes DEVEM passar antes do
  commit. O CI NÃO DEVE ficar vermelho.
- A imagem Docker DEVE rodar sem root, sem npm em runtime e sem vulnerabilidade HIGH/CRITICAL corrigível. Nenhum
  segredo DEVE entrar no repositório.
- Código, tabelas e enums em inglês. Documentação, mensagens ao usuário e commits em português.

**Justificativa:** padrões fixos reduzem decisões repetidas e mantêm o projeto auditável.

### IX. Simplicidade

- Implementar só o que a tarefa pede. Spam/abuso e login de denunciante estão fora do escopo até nova decisão.
- Toda nova decisão de arquitetura DEVE virar uma linha em `docs/adr/README.md` antes do código.

**Justificativa:** cada funcionalidade a mais é superfície de ataque e dado a mais para proteger.

## Restrições técnicas

- Infraestrutura on-premise: PostgreSQL 18, HashiCorp Vault (Transit), Redis, storage S3-compatível e ClamAV.
- Uma única empresa (sem multi-tenant).
- Login da equipe com senha e MFA obrigatório por TOTP. Sessão expira após 15 min sem uso e 8 h no máximo.
- Identificadores UUID v7 gerados pelo banco. Datas em `timestamptz`.
- Expurgo por crypto-shredding ao fim do prazo de retenção, mantendo só dados estatísticos.
- Backups mantidos por tempo indeterminado (D26). O expurgo não os alcança, e isso DEVE constar no RIPD.

## Fluxo de desenvolvimento

- Cada funcionalidade parte de uma tarefa de `docs/tarefas/` e passa por spec, plano e tarefas do Spec Kit.
- O plano DEVE conter a checagem "Constitution Check" contra os princípios I a IX. Uma violação só é aceita se
  justificada na tabela "Complexity Tracking".
- Toda mudança passa por pull request com o CI verde: lint, tipos, testes, e2e com checagem de divergência do
  schema, Trivy, gitleaks e CodeQL.
- Na revisão, mudanças em rotas públicas, logs, criptografia, permissões ou auditoria DEVEM ser conferidas contra
  os princípios I a V.

## Governance

- Esta constituição prevalece sobre specs, planos, tarefas e práticas informais.
- Mudar um princípio exige registrar a decisão em `docs/adr/README.md`, com motivo e data, e atualizar esta
  constituição na mesma mudança.
- Versionamento semântico: MAJOR para remover ou redefinir um princípio, MINOR para acrescentar princípio ou
  ampliar uma regra, PATCH para ajustes de redação.
- Orientações do dia a dia ficam em `AGENTS.md` e `README.md`, que não podem contradizer esta constituição.

**Version**: 1.1.0 | **Ratified**: 2026-11-27 | **Last Amended**: 2026-11-28
