# Feature Specification: Controle de acesso — políticas reais da matriz de permissões

**Feature Branch**: `main` (nenhuma branch criada: não há hook `before_specify` registrado; decisão do usuário)

**Created**: 2026-11-28

**Status**: Draft

**Input**: User description: "Próxima tarefa do passo 4 ('Equipe interna') da ordem do backlog:
`docs/tarefas/05-access-control.md`, do ACL-01 ao ACL-05 (o ACL-00 foi feito na feature 004). Os IDs ACL-xx, os
critérios de aceite e as decisões D10, D20 (DPO lê todas as denúncias, sem tratar), D21 (ninguém altera os próprios
perfis), D47, D54, D55 e o ADR 0053 valem como requisitos. O que já existe é referenciado, não reespecificado. O
módulo de denúncias (reports, case-management) ainda não existe: as políticas que dependem dele (escopo por atribuição
e conflito de interesse no WHERE, princípio IV) ficam prontas e testadas contra a tabela `reports` que já existe no
banco, e o uso real pelas rotas fica para as features de domínio."

## Escopo

A feature transforma a matriz de permissões do ACL-01 em regras reais do servidor: quem pode fazer o quê (por
perfil) e sobre qual denúncia (por atribuição e por conflito de interesse), com a mesma regra decidindo o acesso a um
registro e filtrando as listagens na consulta. Fecha também a regra "toda rota administrativa declara sua permissão"
com um teste que falha se alguma rota ficar sem declaração.

**Tarefas do backlog cobertas**: ACL-01, ACL-02, ACL-03, ACL-04 e ACL-05.

**O que já existe e não é reespecificado**:

- **Decisão e pacotes (D53, D54, feature 004, ADR 0053)**: autorização com negação por padrão (rota administrativa
  sem declaração responde 403 e aparece no log da inicialização), declaração de permissão por rota e checagem por
  registro no serviço, negações da autorização gravadas como `ACCESS_DENIED` (com política e habilidade) pelo
  assinante de auditoria, 401 e 403 distinguíveis, e o padrão "função de escopo única" provado só em teste
  (`test/contract/auth/example/`). O mapeamento de cada linha da matriz (rota, serviço ou consulta) está no ADR 0053.
- **Catálogo de habilidades (D55, feature 005)**: os 12 códigos `recurso.ação` em
  `src/modules/access-control/abilities.ts`, com o perfil que concede cada um e o escopo (global ou por registro),
  devolvidos pelo `GET /me`, com testes de concordância. Políticas consultam a habilidade, nunca o perfil direto.
- **Política de usuários (feature 005)**: `UsersPolicy` (gerenciar a equipe; agir só sobre outra pessoa, D21).
- **Identidade e sessão (D47, features 004 e 006)**: identidade da equipe relida a cada requisição (perfis e status),
  guard da área administrativa, ponte de sessão, ator de auditoria por contexto (D46).
- **Trilha da auditoria (feature 003)**: o Auditor já lê a trilha, hoje com a checagem do perfil escrita na própria
  rota (e com `ACCESS_DENIED` próprio, metadata `required: AUDITOR`).
- **Banco**: as tabelas `reports` (com `assigned_to_id` e `shredded_at`), `report_access_blocks` (conflito de
  interesse por pessoa e denúncia), `report_assignments` e `identity_reveal_requests` já existem desde o schema
  inicial.

**Fora do escopo** (fica para as features de domínio, que usam o que esta feature entrega): as rotas de denúncias,
triagem, mensagens, notas, revelação de identidade, retenção, categorias, parâmetros e indicadores; o cadastro e a
remoção de bloqueios por conflito. A conferência "four-eyes" no banco já existe (CHECK `reveal_four_eyes` do schema
inicial). Ver Premissas.

## Clarifications

### Session 2026-11-28

- Q: O 410 da denúncia expurgada vem antes ou depois da regra de escopo? → A: escopo primeiro; fora do escopo, 404;
  o 410 só para quem está dentro do escopo. A frase correspondente do ADR 0053 é ajustada na primeira tarefa e a
  decisão é registrada (Q1 = B, FR-012).
- Q: O 404 de um id inexistente também gera `ACCESS_DENIED`? → A: sim; todo 404 de denúncia grava `ACCESS_DENIED`
  com código de motivo `OUT_OF_SCOPE` ou `NOT_FOUND`, com o mesmo custo e tempo nos dois casos (Q2 = B, FR-018).
- As premissas da spec foram aceitas: 403 para quem não tem nenhuma habilidade de leitura de denúncias; escopo do
  Analista só por `reports.assigned_to_id`.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Cada perfil faz só o que a matriz permite (Priority: P1)

A Gestora de compliance tria e atribui denúncias; o Analista trata só o que foi atribuído a ele; o DPO lê todas as
denúncias, mas não trata nenhuma; o Administrador gerencia equipe, categorias e SLA e nunca lê denúncia; o Auditor só
lê a trilha e os indicadores. O servidor decide cada uma dessas permissões por uma regra única por habilidade, igual
à que o `GET /me` já anuncia ao front.

**Why this priority**: é o núcleo da tarefa (ACL-01) e a base de todas as outras histórias. Sem ela, as features de
domínio não têm onde declarar suas permissões.

**Independent Test**: teste em tabela com cada perfil (e combinações de perfis) × cada uma das 12 habilidades,
comparando a decisão do servidor com a matriz documentada e com o catálogo.

**Acceptance Scenarios**:

1. **Given** uma pessoa só com o perfil DPO, **When** o servidor avalia ler o conteúdo de uma denúncia não bloqueada
   para ela, **Then** permite; **When** avalia mudar status, atribuir, priorizar, escrever mensagem ou nota, ou pedir
   revelação de identidade, **Then** nega (D20).
2. **Given** uma pessoa só com o perfil Administrador, **When** o servidor avalia listar ou ler qualquer denúncia,
   **Then** nega; **When** avalia gerenciar usuários, categorias ou SLA, **Then** permite.
3. **Given** uma pessoa só com o perfil Auditor, **When** o servidor avalia ler a trilha ou os indicadores, **Then**
   permite; **When** avalia qualquer habilidade sobre denúncias, **Then** nega.
4. **Given** uma pessoa com Administrador e Analista (D21, perfis concedidos por outra pessoa), **When** o servidor
   avalia ler uma denúncia atribuída a ela, **Then** permite pelo perfil de Analista; o perfil de Administrador
   sozinho não concede nada sobre denúncias.
5. **Given** o Auditor chamando a rota da trilha e qualquer outro perfil chamando a mesma rota, **When** as requisições
   chegam, **Then** o Auditor recebe os dados e os demais recebem 403 com `ACCESS_DENIED` na trilha, agora pela
   declaração de permissão da rota e não por checagem escrita no handler.

---

### User Story 2 - Acesso a uma denúncia por atribuição e conflito de interesse (Priority: P1)

O Analista só alcança as denúncias atribuídas a ele. Quem tem registro de conflito de interesse numa denúncia nunca a
alcança, qualquer que seja o perfil, inclusive Gestora e DPO. Para quem tenta abrir uma denúncia fora do próprio
escopo, a resposta não revela que ela existe.

**Why this priority**: é a regra por registro (ACL-02) que protege o conteúdo das denúncias contra acesso de quem não
deve vê-lo; sem ela não há como liberar nenhuma rota de detalhe no domínio.

**Independent Test**: regras de acesso por registro avaliadas sobre denúncias reais da tabela `reports` (com
atribuição e bloqueios criados no teste) e uma rota de teste (só em `test/`) que lê uma denúncia por id, conferindo
código de resposta e registro na trilha.

**Acceptance Scenarios**:

1. **Given** uma denúncia atribuída ao Analista A, **When** A tenta lê-la, **Then** é permitido; **When** o Analista B
   tenta lê-la, **Then** recebe 404 (não 403), igual ao de um id inexistente, e a trilha registra `ACCESS_DENIED`.
2. **Given** um bloqueio por conflito da Gestora G na denúncia X, **When** G tenta ler, triar ou tratar X, **Then** é
   negado, mesmo sendo Gestora.
3. **Given** um bloqueio por conflito do DPO na denúncia X, **When** o DPO tenta ler X, alterar retenção ou legal hold
   de X, ou decidir uma revelação de identidade de X, **Then** é negado.
4. **Given** uma denúncia expurgada (`shredded_at` preenchido), **When** alguém tenta ler o conteúdo, **Then** não há
   conteúdo para ninguém: quem está no escopo dela recebe 410; quem está fora recebe 404 (FR-012).
5. **Given** um Analista atribuído a uma denúncia, **When** o servidor avalia mudar status, escrever mensagem ou nota,
   ou pedir revelação de identidade, **Then** permite; **When** a denúncia é reatribuída a outra pessoa, **Then** a
   próxima avaliação já nega.
6. **Given** um pedido de revelação feito pela pessoa P, **When** a mesma pessoa P (por ter também o perfil DPO)
   tenta aprovar ou rejeitar o próprio pedido, **Then** é negado (four-eyes, princípio IV).

---

### User Story 3 - Listagens filtradas na consulta (Priority: P1)

Cada pessoa, ao listar denúncias, recebe exatamente o conjunto a que tem direito, e o filtro é aplicado na própria
consulta ao banco, nunca carregando tudo para filtrar depois.

**Why this priority**: princípio IV da constituição e ACL-03; é o que impede vazamento por erro de código nas
listagens, que são a entrada principal do backoffice.

**Independent Test**: o cenário do ACL-03 sobre o banco real: 3 analistas, 1 gestora com bloqueio, 1 DPO e 10
denúncias; cada pessoa recebe exatamente o conjunto esperado, numa só consulta.

**Acceptance Scenarios**:

1. **Given** 10 denúncias distribuídas entre 3 analistas (algumas sem atribuição) e um bloqueio da Gestora em uma
   delas, **When** cada pessoa lista, **Then** cada analista vê só as suas (menos as bloqueadas para ele), a Gestora vê
   todas menos a bloqueada, o DPO vê todas menos as bloqueadas para ele, e Administrador e Auditor não abrem a
   listagem.
2. **Given** qualquer pessoa e qualquer denúncia do cenário, **When** se compara "aparece na listagem" com "a regra
   de leitura permite", **Then** as duas respostas coincidem sempre (regra única para registro e consulta).
3. **Given** a listagem filtrada, **When** se observa a execução, **Then** o filtro de atribuição e de bloqueio
   acontece na mesma consulta que traz as denúncias, sem consulta adicional por denúncia.

---

### User Story 4 - Negações sempre na trilha (Priority: P2)

O Auditor consegue ver, na trilha, toda tentativa negada na área administrativa: os 403 por falta de habilidade e os
404 que escondem uma denúncia fora do escopo, sem nenhum conteúdo de denúncia.

**Why this priority**: ACL-04; a maior parte já existe (negação pela autorização gravada pelo assinante). Falta o caso
do 404 e a metadata padronizada.

**Independent Test**: provocar cada tipo de negação e conferir o registro `ACCESS_DENIED` com `result = DENIED`,
habilidade e tipo de recurso na metadata.

**Acceptance Scenarios**:

1. **Given** qualquer rota administrativa negada com 403, **When** a negação acontece, **Then** a trilha registra
   `ACCESS_DENIED` com `result = DENIED`, a habilidade exigida e o tipo de recurso.
2. **Given** uma leitura de denúncia fora do escopo respondida com 404, **When** a negação acontece, **Then** a
   trilha registra `ACCESS_DENIED` com a habilidade, o tipo de recurso e o id da denúncia, e a resposta HTTP é
   indistinguível da de um id inexistente.

---

### User Story 5 - Nenhuma rota sem permissão declarada (Priority: P2)

Quem cria uma rota administrativa nova sem declarar a permissão vê o teste falhar antes do merge, além da negação por
padrão em execução.

**Why this priority**: ACL-01 e ACL-05; garante que a regra continue valendo quando as features de domínio criarem
dezenas de rotas.

**Independent Test**: teste de convenção que percorre todas as rotas administrativas registradas e falha se alguma
não declara permissão, ou se usa a declaração "qualquer pessoa da equipe" fora da lista justificada.

**Acceptance Scenarios**:

1. **Given** todas as rotas administrativas da aplicação, **When** o teste de convenção roda, **Then** cada uma tem
   uma permissão declarada (habilidade do catálogo) ou está na lista explícita de rotas "qualquer pessoa da equipe",
   com a regra checada no serviço.
2. **Given** uma rota de teste sem declaração, **When** o teste de convenção a encontra, **Then** falha nomeando a
   rota.

---

### Edge Cases

- Pessoa com perfis acumulados (ex.: DPO + Analista): lê todas as denúncias (DPO), trata só as atribuídas a ela
  (Analista); o bloqueio por conflito continua negando tudo naquela denúncia.
- Gestora + DPO: lê e tria todas, menos as bloqueadas para ela.
- Denúncia sem atribuição: nenhum analista a alcança; Gestora e DPO sim (salvo bloqueio).
- Perfil retirado, bloqueio de conta ou desativação no meio da sessão: vale na requisição seguinte, porque a
  identidade é relida a cada requisição (já existe); a próxima avaliação já nega.
- Atribuição trocada entre duas requisições do mesmo analista: a segunda já responde 404.
- Bloqueio por conflito criado para alguém que é o atribuído da denúncia: o bloqueio prevalece (nega).
- Id malformado na leitura de denúncia: 400 da validação, antes de qualquer regra (sem `ACCESS_DENIED`).
- Pessoa sem nenhum perfil que acesse denúncias (só Administrador, só Auditor) chamando a leitura de uma denúncia:
  403 por falta de habilidade (não há o que esconder: ela não alcança nenhuma), com `ACCESS_DENIED`.
- Denúncia expurgada e fora do escopo de quem pede: 404, como qualquer denúncia fora do escopo (FR-012).
- Id bem formado que não existe: 404 idêntico ao de fora do escopo, também com `ACCESS_DENIED` (motivo
  `NOT_FOUND`, FR-018).
- Pedido de revelação aprovado por quem o pediu, mesmo com perfil DPO: negado.

## Requirements _(mandatory)_

### Functional Requirements

**Matriz e políticas (ACL-01)**

- **FR-001**: Cada linha da matriz do ACL-01 DEVE ter uma regra no servidor, expressa sobre os códigos do catálogo
  único (D55); nenhuma regra consulta o perfil direto. Os 12 códigos existentes não são renomeados nem removidos;
  código novo só se a matriz exigir, de forma aditiva.
- **FR-002**: A matriz perfil × habilidade (com o alcance por registro, "se atribuída") DEVE continuar documentada
  num único lugar, `docs/tarefas/05-access-control.md`, e um teste DEVE falhar se essa matriz, o catálogo e as regras
  divergirem. O mapeamento por camada (rota, serviço ou consulta) fica como documentação no ADR 0053.
- **FR-003**: O perfil Administrador, sozinho, NÃO DEVE conceder nenhuma habilidade sobre denúncias; o Auditor,
  sozinho, só trilha e indicadores. Perfis acumulados (D21) concedem a união das habilidades, sem que um perfil
  amplie o escopo por registro de outro.
- **FR-004**: O DPO DEVE poder listar e ler todas as denúncias e o conteúdo delas, e NÃO DEVE poder triar, atribuir,
  priorizar, bloquear por conflito, mudar status, escrever mensagens ou notas nem pedir revelação (D20), salvo se
  acumular outro perfil que conceda isso.
- **FR-005**: A rota da trilha de auditoria DEVE passar a declarar a habilidade `audit.read` como as demais rotas,
  deixando de ter a checagem do perfil escrita no handler; o comportamento externo (200 para o Auditor, 403 com
  `ACCESS_DENIED` para os demais) não muda.
- **FR-006**: As regras de usuários existentes (`UsersPolicy`, D21: ninguém altera os próprios perfis nem o próprio
  status) DEVEM continuar valendo e entrar na mesma matriz e nos mesmos testes.

**Acesso a uma denúncia (ACL-02)**

- **FR-007**: A Gestora de compliance DEVE alcançar qualquer denúncia; o Analista, só as que têm `assigned_to_id`
  igual ao dele; o DPO, todas para leitura.
- **FR-008**: Um registro de conflito de interesse para a pessoa numa denúncia DEVE negar sempre, para qualquer perfil
  (inclusive Gestora e DPO) e para toda habilidade por registro: ler, triar, tratar, pedir e decidir revelação,
  alterar retenção e legal hold daquela denúncia.
- **FR-009**: Tratar (mudar status, mensagens, notas) e pedir revelação DEVEM exigir: não estar bloqueado e ser
  Gestora ou o Analista atribuído. O DPO nunca trata.
- **FR-010**: Decidir (aprovar ou rejeitar) uma revelação DEVE exigir o perfil DPO, não estar bloqueado na denúncia e
  não ser quem fez o pedido (four-eyes). A conferência equivalente no banco já existe (CHECK `reveal_four_eyes`).
- **FR-011**: Para quem tem a habilidade de ler denúncias mas não alcança aquela denúncia (não atribuída ou bloqueada),
  a resposta DEVE ser 404, idêntica à de um id inexistente (corpo e código); quem não tem a habilidade em nenhuma
  denúncia recebe 403.
- **FR-012**: Denúncia expurgada (`shredded_at` preenchido) NÃO DEVE ter conteúdo para ninguém e responde 410 no
  detalhe só para quem está dentro do escopo dela. O escopo vem primeiro: fora dele, a resposta é o 404 de FR-011,
  mesmo para denúncia expurgada (Q1 = B; a frase "410 antes da política" do ADR 0053 é ajustada).

**Escopo na consulta (ACL-03)**

- **FR-013**: DEVE existir uma função de escopo única de denúncias (`scopeReportsFor`, ACL-03) que, dada a pessoa,
  aplica atribuição e bloqueios por conflito como condição da própria consulta de listagem, numa só consulta.
- **FR-014**: A regra de acesso por registro (FR-007 a FR-009) DEVE derivar da mesma definição de escopo, de modo que
  "aparece na listagem" e "a regra de leitura permite" coincidam para toda pessoa e toda denúncia.
- **FR-015**: Para quem não tem a habilidade de listar denúncias, a função de escopo DEVE resultar em conjunto vazio
  (nunca em "todas"), como defesa adicional à negação da rota.
- **FR-016**: A função de escopo e as regras DEVEM ser testadas contra as tabelas reais `reports` e
  `report_access_blocks`, com o cenário do ACL-03 (3 analistas, 1 gestora com bloqueio e 10 denúncias), acrescido do
  DPO com bloqueio.

**Auditoria das negações (ACL-04)**

- **FR-017**: Todo 403 em rota administrativa DEVE gerar `ACCESS_DENIED` com `result = DENIED`, a habilidade exigida
  e o tipo de recurso na metadata (só códigos e enums, nunca texto nem conteúdo). Os 403 já gravados pelo assinante
  passam a seguir o mesmo formato.
- **FR-018**: O 404 de FR-011 DEVE gerar `ACCESS_DENIED` com a habilidade, o tipo de recurso e o id da denúncia, pela
  auditoria da própria operação. Todo 404 de denúncia grava `ACCESS_DENIED`, inclusive o de id inexistente, com um
  código de motivo na metadata (`OUT_OF_SCOPE` ou `NOT_FOUND`), para que custo e tempo sejam iguais nos dois casos e
  a resposta não revele existência (Q2 = B).
- **FR-019**: As features de domínio DEVEM poder usar a negação-como-404 e o registro de FR-018 sem reescrevê-los
  (um único ponto de uso, entregue por esta feature).

**Testes da matriz e convenção (ACL-05)**

- **FR-020**: DEVE existir um teste em tabela: cada perfil (e as combinações relevantes de FR-003) × cada habilidade
  × (denúncia atribuída à pessoa, não atribuída, com conflito), com a decisão esperada vinda da matriz documentada.
- **FR-021**: DEVE existir um teste de convenção que falha se alguma rota administrativa não declara permissão. A
  declaração "qualquer pessoa da equipe" só é aceita para rotas de uma lista explícita e justificada (próprio perfil,
  próprias sessões e segurança); rota de denúncia nunca usa essa declaração (declara a habilidade na rota e o escopo
  fica no serviço, D62). Rotas abertas antes da sessão completa continuam com a marcação própria do login.
- **FR-022**: Estes testes DEVEM ser escritos antes das regras e falhar primeiro (princípio VII).

### Privacy & Security _(mandatory)_

- **Personal or sensitive data handled**: nenhum dado novo é coletado. As regras leem só identificadores e campos em
  claro já existentes: id e perfis da pessoa (identidade da sessão), `reports.id`, `reports.assigned_to_id`,
  `reports.shredded_at`, `report_access_blocks (report_id, user_id)` e, para four-eyes,
  `identity_reveal_requests.requested_by_id`. Nenhum conteúdo cifrado é lido nem decifrado para decidir acesso.
- **Anonymity impact**: N/A para rotas públicas: a feature não toca `/api/public/v1/*`. Nada vai na URL além do id da
  denúncia nas rotas administrativas (UUID, já previsto). A resposta 404 para denúncia fora do escopo evita revelar
  existência a quem não deve, inclusive para denúncia expurgada (FR-012) e com o mesmo custo e tempo para id
  inexistente (FR-018).
- **Encryption**: N/A: nenhum campo novo; as regras nunca precisam da chave de dados da denúncia, e a decisão de acesso
  acontece antes de qualquer decifragem.
- **Access**: é o objeto da feature. Perfis conforme a matriz do ACL-01 (FR-001 a FR-006); escopo por atribuição
  (Analista) e conflito de interesse para todos os perfis (FR-007 a FR-010); filtro sempre no `WHERE` (FR-013 a
  FR-016); negação por padrão e declaração obrigatória (FR-021); ninguém altera os próprios perfis (D21, FR-006);
  four-eyes na decisão de revelação (FR-010).
- **Audit events**: `ACCESS_DENIED` (`result = DENIED`) para todo 403 e para o 404 que esconde denúncia, com
  metadata só de habilidade, tipo de recurso (e política, quando vier da autorização), motivo do 404
  (`OUT_OF_SCOPE`/`NOT_FOUND`) e o id da denúncia como recurso. Nenhuma ação nova no catálogo; o schema da metadata
  de `ACCESS_DENIED` ganha campos só de códigos/enums.
- **Retention**: N/A para dados próprios. Denúncia expurgada fica sem conteúdo para todos (FR-012); bloqueios e
  atribuição continuam existindo como dado em claro de controle, o que permite aplicar o escopo também depois do
  expurgo. Registros `ACCESS_DENIED` seguem a guarda da trilha (D49).

### Key Entities

- **Habilidade**: código `recurso.ação` do catálogo único (D55), com os perfis que o concedem e o escopo (global ou
  por registro). Já existe.
- **Política**: conjunto de regras por recurso (usuários, denúncias, trilha, parâmetros, categorias, indicadores,
  retenção, revelação) que decide uma habilidade para a pessoa, com ou sem um registro.
- **Escopo de denúncias**: definição única de quais denúncias a pessoa alcança (todas, só as atribuídas ou nenhuma,
  sempre menos as bloqueadas para ela), usada tanto pela regra por registro quanto pelo filtro da consulta.
- **Bloqueio por conflito de interesse**: par denúncia × pessoa em `report_access_blocks`; nega tudo naquela denúncia
  para aquela pessoa. Já existe (criação fica para case-management).
- **Negação auditada**: registro `ACCESS_DENIED` na trilha, com habilidade, tipo de recurso e, quando houver, o id do
  registro.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% das combinações perfil × habilidade × situação da denúncia (atribuída, não atribuída, com conflito)
  do teste em tabela batem com a matriz documentada; para os 5 perfis isolados são 5 × 12 × 3 = 180 casos, mais as
  combinações de perfis.
- **SC-002**: No cenário do ACL-03 (3 analistas, 1 gestora com bloqueio, 1 DPO, 10 denúncias), cada pessoa recebe
  exatamente o conjunto esperado: zero denúncias a mais e zero a menos, numa única consulta por listagem.
- **SC-003**: Para todas as pessoas e denúncias do cenário, "aparece na listagem" e "pode ler" coincidem em 100% dos
  pares.
- **SC-004**: 100% das rotas administrativas registradas declaram permissão; uma rota sem declaração faz o teste de
  convenção falhar.
- **SC-005**: 100% das negações provocadas nos testes (403, 404 de escopo e 404 de id inexistente) geram exatamente um registro
  `ACCESS_DENIED` com `result = DENIED`, e nenhum desses registros contém texto livre ou conteúdo de denúncia.
- **SC-006**: A resposta a uma denúncia fora do escopo é idêntica (código e corpo) à de um id inexistente em 100% dos
  casos testados, e no teste de tempo isolado (40 amostras alternadas) a diferença entre as medianas dos dois casos
  é menor que 10% da menor mediana, com piso de 1 ms.
- **SC-007**: Nenhum código de habilidade existente muda; o `GET /me` devolve o mesmo catálogo de antes para cada
  perfil.

## Assumptions

- **Premissa principal (módulo de denúncias ausente)**: reports e case-management ainda não existem. Esta feature
  entrega as políticas de todas as linhas da matriz, a função de escopo e a negação-como-404 auditada, prontas e
  testadas contra as tabelas que já existem no banco (`reports`, `report_access_blocks`, `identity_reveal_requests`),
  inclusive por uma rota de teste em `test/` (nunca importada por `src/`). Declarar essas regras nas rotas reais de
  listagem, detalhe, triagem, mensagens, notas, revelação, retenção, categorias, parâmetros e indicadores é trabalho
  das features de domínio (REP, CASE, MSG, IDV, RET, CAT, REPT), que só referenciam o que existe aqui.
- A única rota real hoje sobre o que a matriz cobre, além das de usuários, é a da trilha de auditoria; ela é a única
  migrada nesta feature (FR-005).
- Escopo do Analista é pelo `reports.assigned_to_id` (ACL-02); o histórico em `report_assignments` não concede acesso.
- Quem não tem a habilidade de ler denúncias (só Administrador, só Auditor) recebe 403 na leitura de uma denúncia, e
  não 404: não há existência a esconder de quem não alcança nenhuma. O 404 vale para quem tem a habilidade e está fora
  do escopo daquela denúncia (inclusive por bloqueio).
- A metadata de `ACCESS_DENIED` gravada hoje na rota da trilha (`required: AUDITOR`) passa ao formato padronizado
  (habilidade e tipo de recurso); só o Auditor lê a trilha, e o front não depende desse campo.
- As regras de parâmetros seguem o backlog: SLA e prazos pelo Administrador (`settings.sla`), prazo de retenção pelo
  DPO (`retention.manage`); a separação por chave do parâmetro é da feature de catálogo.
- O exemplo de política e escopo de `test/contract/auth/example/` continua só como prova da decisão da feature 004; o
  plano decide se ele é aposentado quando as regras reais tiverem testes equivalentes.
- Não há migration prevista: as tabelas necessárias já existem.
