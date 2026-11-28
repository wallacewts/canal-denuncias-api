# Feature Specification: Trilha de auditoria completa

**Feature Branch**: `main` (nenhuma branch criada: não há hook `before_specify` registrado)

**Created**: 2026-11-28

**Status**: Draft

**Input**: User description: "Conteúdo de `docs/tarefas/02-audit.md` (tarefas AUDIT-01 a AUDIT-09). Os IDs de
tarefa, os critérios de aceite e as decisões D11, D25, D33 e D40 a D44 de `docs/adr/README.md` (inclusive a auditoria
por lote da recifragem) valem como requisitos. Referenciar o que já existe e especificar só o que falta."

## Escopo

Esta feature completa a trilha de auditoria que todos os módulos vão usar para registrar quem fez o quê, quando e
com que resultado. É o fim da fundação de segurança, segundo passo da ordem de implementação do backlog: depois dela,
os módulos de domínio (equipe, denúncias, mensagens, tratativa) podem auditar suas ações sem repetir código.

**Tarefas do backlog cobertas**: AUDIT-01, AUDIT-03, AUDIT-04, AUDIT-05, AUDIT-06, AUDIT-07, AUDIT-08 e AUDIT-09
(retenção e particionamento da trilha, decidido em 2026-11-28). A AUDIT-02 já tem o núcleo entregue (ver abaixo).

**O que já existe e é reaproveitado (não é reespecificado)**:

- **Gravação com cadeia de hash (núcleo da AUDIT-02, feature 001, D33)**: o único jeito de escrever na trilha. Cada
  registro guarda o hash do anterior; as gravações são serializadas para a cadeia nunca bifurcar; o horário é definido
  antes do cálculo do hash; o hash cobre também IP e user-agent; a gravação pode participar da transação da operação
  auditada. Já existe teste de 50 gravações concorrentes.
- **Imutabilidade no banco (feature 001)**: o perfil da API não pode alterar nem apagar registros; um gatilho bloqueia
  alteração, exclusão e esvaziamento da tabela para qualquer perfil; uma regra do banco recusa IP para quem não é da
  equipe interna. Hoje isso foi verificado à mão e com testes pontuais, não como suíte própria.
- **Eventos já gravados**: `USER_CREATED` (criação do primeiro administrador, feature 001), `KEYS_REWRAPPED` (um
  registro por lote de recifragem, na mesma transação das gravações do lote) e `KEYS_REWRAP_RUN` (resumo de cada
  execução da recifragem), ambos da feature 002 (D43).
- **Horário exato (D25)**: o horário é gravado exato para todos os atores, inclusive o denunciante. Em troca, só o
  perfil Auditor lê a trilha.

**O que esta feature entrega**: o catálogo fechado de ações e tipos de recurso; a descoberta automática do ator a
partir do contexto (equipe, denunciante ou sistema); a auditoria declarativa de rotas, com resultado de sucesso,
negado ou falha; a proteção do campo de metadados contra texto livre; a consulta da trilha pelo Auditor; a
verificação de integridade da cadeia (por comando e por rota); a suíte automatizada que prova a imutabilidade; e a
guarda da trilha por 5 anos, com a estrutura por período, o expurgo automático e o novo ponto de partida da cadeia.

## Clarifications

### Session 2026-11-28

- Q: A AUDIT-09 (retenção e particionamento da trilha) entra nesta feature? → A: Sim, inteira (opção C). A user
  story 7 e os FR-028 a FR-031 fazem parte do escopo.
- Q: Por quanto tempo a trilha é guardada? → A: 5 anos após o registro, com expurgo automático dos registros mais
  antigos (opção B). O prazo foi decidido pelo usuário e ainda precisa ser validado com o jurídico e o DPO e constar
  no RIPD.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Só ações conhecidas, com metadados sem texto livre (Priority: P1)

Quem desenvolve um módulo registra uma ação na trilha escolhendo-a de um catálogo fechado, e os metadados dessa ação
só aceitam os campos previstos para ela, todos identificadores ou códigos. Assim, nenhum módulo grava por engano
conteúdo de denúncia, nome de pessoa ou um texto qualquer na trilha, que nunca é apagada.

**Why this priority**: a trilha é permanente e append-only. Um único texto livre gravado ali não pode ser corrigido
depois. Fechar o catálogo e os metadados antes de os módulos de domínio existirem impede o erro na origem
(constituição, princípio II).

**Independent Test**: gravar uma ação do catálogo com metadados válidos (aceito), uma ação fora do catálogo
(recusada) e metadados com um campo não previsto ou com texto livre (recusados), sem nenhum outro módulo.

**Acceptance Scenarios**:

1. **Given** uma ação do catálogo com os metadados previstos para ela, **When** é registrada, **Then** a trilha ganha
   um registro encadeado com esses metadados.
2. **Given** um nome de ação que não está no catálogo, **When** alguém tenta registrá-lo, **Then** o registro é
   recusado antes de chegar à trilha.
3. **Given** metadados com um campo que a ação não prevê (por exemplo, um campo `texto` com "XQZ"), **When** a ação é
   registrada, **Then** o registro é recusado e o valor recusado não aparece na mensagem de erro nem em log.
4. **Given** as ações que já são gravadas hoje (`USER_CREATED`, `KEYS_REWRAPPED`, `KEYS_REWRAP_RUN`), **When** o
   catálogo entra em vigor, **Then** elas continuam sendo gravadas, agora validadas pelo catálogo.

---

### User Story 2 - O ator é descoberto sozinho, sem rastro do denunciante (Priority: P1)

Quando uma ação é registrada durante uma requisição, a trilha descobre sozinha quem a fez: um membro da equipe (com o
identificador dele, o IP real e o navegador), o denunciante (sem identificador, sem IP e sem navegador) ou o próprio
sistema, em jobs e comandos (sem IP). Quem escreve o módulo não precisa informar isso a cada chamada, e não tem como
informar errado.

**Why this priority**: o anonimato é inegociável (princípio I). Se cada módulo informasse o ator à mão, bastaria um
esquecimento numa rota pública para gravar o IP de um denunciante. A descoberta automática elimina essa chance.

**Independent Test**: fazer uma requisição numa rota pública de teste, com cabeçalhos de IP de origem e de
navegador, que registra uma ação; o registro sai como denunciante, sem identificador, IP nem navegador. Repetir numa
rota administrativa de teste com um membro da equipe simulado; o registro sai com o identificador, o IP real e o
navegador truncado. Repetir num comando de linha de comando; o registro sai como sistema, sem IP.

**Acceptance Scenarios**:

1. **Given** uma requisição pública com cabeçalho de IP de origem e de navegador, **When** a rota registra uma ação,
   **Then** o registro tem ator denunciante, sem identificador de usuário, sem IP e sem navegador.
2. **Given** uma requisição administrativa de um membro da equipe, **When** a rota registra uma ação, **Then** o
   registro tem ator equipe, o identificador do membro, o IP real do cliente (atrás do proxy) e o navegador limitado a
   255 caracteres.
3. **Given** um job agendado ou um comando de linha de comando, **When** ele registra uma ação, **Then** o registro
   tem ator sistema, sem identificador de usuário, sem IP e sem navegador.
4. **Given** um registro feito fora de qualquer requisição, job ou comando conhecido, **When** o ator não pode ser
   determinado, **Then** o registro é recusado, em vez de ser gravado com um ator adivinhado.

---

### User Story 3 - Rotas auditadas sem repetir código (Priority: P1)

Quem escreve uma rota marca nela qual ação e qual recurso ela audita, e a trilha registra o resultado sozinha:
sucesso quando a rota termina bem, negado quando o acesso é recusado e falha quando ocorre um erro. Operações que
alteram dados continuam registrando dentro da própria transação; a marcação serve para leituras e casos simples.

**Why this priority**: leituras de dado sensível também precisam ficar na trilha (princípio V), e são a maioria das
rotas da equipe. Sem a marcação declarativa, cada leitura teria código repetido e fácil de esquecer.

**Independent Test**: uma rota de teste marcada com uma ação registra sucesso quando responde, negado quando recusa
o acesso e falha quando lança um erro, sempre com o identificador do recurso e sem o conteúdo da resposta.

**Acceptance Scenarios**:

1. **Given** uma rota marcada que responde com sucesso, **When** é chamada, **Then** a trilha registra a ação com
   resultado sucesso e o identificador do recurso acessado.
2. **Given** uma rota marcada que recusa o acesso (403), **When** é chamada, **Then** a trilha registra a ação com
   resultado negado.
3. **Given** uma rota marcada que termina em erro, **When** é chamada, **Then** a trilha registra a ação com resultado
   falha, e a resposta de erro continua sem dado da requisição (feature 001).
4. **Given** uma operação que altera dados e registra na própria transação, **When** a transação é desfeita, **Then**
   nem a alteração nem o registro ficam gravados.
5. **Given** que a gravação na trilha falha numa leitura marcada, **When** a rota já tinha o resultado, **Then** a
   resposta não é entregue como sucesso sem registro: o sistema responde com erro genérico, porque uma leitura de dado
   sensível sem auditoria viola o princípio V.

---

### User Story 4 - Imutabilidade provada a cada mudança (Priority: P1)

A suíte automatizada prova, a cada mudança no código, que a trilha não pode ser alterada: o perfil da API não
consegue alterar nem apagar registros, nem o dono da tabela consegue alterar, apagar ou esvaziar a tabela, e o banco
recusa um registro de denunciante com IP.

**Why this priority**: a imutabilidade é a garantia central da trilha (D11). Hoje ela depende de verificação manual;
uma migration futura poderia desfazê-la sem ninguém perceber.

**Independent Test**: rodar a suíte de integração contra o banco de teste; as tentativas de alterar, apagar e
esvaziar falham pelos motivos esperados, e a inserção de denunciante com IP é recusada.

**Acceptance Scenarios**:

1. **Given** o perfil usado pela API, **When** tenta alterar ou apagar um registro da trilha, **Then** a operação é
   recusada por falta de permissão.
2. **Given** o perfil dono do schema, **When** tenta alterar, apagar ou esvaziar a trilha, **Then** a operação é
   recusada pelo gatilho de imutabilidade.
3. **Given** um registro com ator denunciante e IP preenchido, **When** alguém tenta inseri-lo diretamente no banco,
   **Then** o banco recusa a inserção.

---

### User Story 5 - O Auditor consulta a trilha (Priority: P2)

Uma pessoa com o perfil Auditor consulta a trilha filtrando por quem fez, ação, tipo e identificador do recurso e
período, recebendo páginas em ordem do mais recente para o mais antigo. A própria consulta fica registrada, com os
filtros usados. Nenhum outro perfil consegue consultar.

**Why this priority**: sem consulta, a trilha existe mas não serve para apurar nada. É do marco Produção no backlog e
depende do controle de acesso (perfil Auditor), por isso vem depois das garantias P1.

**Independent Test**: com uma identidade de Auditor simulada, consultar com e sem filtros e conferir a ordem, a
paginação e o registro da consulta; com uma identidade de outro perfil, receber acesso negado.

**Acceptance Scenarios**:

1. **Given** um Auditor e uma trilha com registros, **When** consulta sem filtro, **Then** recebe a primeira página do
   mais recente para o mais antigo e um cursor para a próxima.
2. **Given** um Auditor, **When** consulta filtrando por ação, ator, recurso ou período, **Then** recebe só os
   registros que atendem a todos os filtros informados.
3. **Given** uma consulta feita, **When** ela termina, **Then** a trilha ganha um registro de consulta com os filtros
   usados (só identificadores, códigos e datas).
4. **Given** um usuário de qualquer outro perfil, **When** tenta consultar, **Then** recebe acesso negado e a
   tentativa fica registrada como negada.
5. **Given** um cursor adulterado ou um filtro inválido (por exemplo, uma ação fora do catálogo), **When** a consulta
   é feita, **Then** a resposta é um erro de validação com mensagem fixa, sem ecoar o valor enviado.

---

### User Story 6 - Verificação de integridade da cadeia (Priority: P2)

O Auditor, ou um job agendado, verifica se a trilha foi adulterada: a verificação recalcula a cadeia inteira em
lotes, sem carregar a tabela de uma vez, e informa se ela está íntegra, quantos registros foram verificados e o
primeiro registro quebrado, se houver. A verificação também fica registrada.

**Why this priority**: a cadeia de hash só protege se alguém a verificar. É do marco Produção e é obrigatória antes de
ir ao ar (README do backlog), mas não bloqueia os módulos de domínio.

**Independent Test**: verificar uma trilha íntegra (resultado íntegro) e uma trilha em que um registro foi alterado
com o gatilho desligado só no teste (resultado quebrado, apontando o registro alterado), pelo comando e pela rota.

**Acceptance Scenarios**:

1. **Given** uma trilha íntegra, **When** a verificação roda, **Then** o resultado é íntegro, com o número de
   registros verificados e nenhum registro quebrado.
2. **Given** um registro cujo conteúdo foi alterado diretamente no banco (só em teste), **When** a verificação roda,
   **Then** o resultado é quebrado e aponta o primeiro registro afetado.
3. **Given** um registro removido do meio da cadeia (só em teste), **When** a verificação roda, **Then** o resultado é
   quebrado e aponta o primeiro registro cujo encadeamento não fecha.
4. **Given** uma trilha com muitos registros, **When** a verificação roda, **Then** ela processa em lotes, com memória
   limitada, e termina sem bloquear as gravações novas.
5. **Given** uma verificação concluída, **When** ela termina, **Then** a trilha ganha um registro de verificação com o
   resultado, a quantidade verificada e o primeiro registro quebrado (só números e códigos).
6. **Given** a verificação pelo comando de linha de comando, **When** a cadeia está quebrada, **Then** o comando
   termina com código de saída diferente de zero, para que um agendamento possa alertar.

---

### User Story 7 - Registros com mais de 5 anos saem da trilha sem quebrar a verificação (Priority: P3)

Os registros da trilha com mais de 5 anos são removidos automaticamente, em blocos inteiros por período. A remoção é
feita por um perfil próprio de manutenção, nunca pela API, e fica registrada na própria trilha. Depois dela, a
verificação de integridade continua funcionando a partir do primeiro registro que restou, e ninguém consegue usar esse
mecanismo para apagar registros recentes e "recomeçar" a cadeia.

**Why this priority**: o prazo de guarda vem da LGPD (eliminação ao fim do tratamento) e é do marco Evolução no
backlog. Não bloqueia os módulos de domínio nem a verificação, mas precisa existir antes que a trilha complete 5 anos;
a estrutura que permite remover por período precisa existir desde já, porque mudá-la depois exige migrar uma tabela
grande.

**Independent Test**: num banco de teste com registros datados de mais e de menos de 5 anos, rodar o expurgo pelo
perfil de manutenção; os blocos antigos somem, os recentes ficam, a remoção fica registrada e a verificação continua
íntegra. Tentar remover um bloco recente, ou remover pelo perfil da API, e conferir que é recusado.

**Acceptance Scenarios**:

1. **Given** registros com mais de 5 anos, **When** o expurgo roda pelo perfil de manutenção, **Then** os blocos de
   período inteiramente mais antigos que 5 anos são removidos e os demais ficam intactos.
2. **Given** um expurgo concluído, **When** a verificação de integridade roda, **Then** a cadeia é aceita a partir do
   primeiro registro restante e o resultado é íntegro.
3. **Given** um expurgo concluído, **When** ele termina, **Then** a trilha ganha um registro com o período removido e
   a quantidade de registros removidos (só números e datas).
4. **Given** um bloco de período que ainda contém registros com menos de 5 anos, **When** alguém tenta removê-lo,
   **Then** a remoção é recusada.
5. **Given** o perfil usado pela API, **When** tenta remover registros ou blocos da trilha, **Then** a operação é
   recusada.
6. **Given** que registros recentes foram removidos por fora do expurgo (simulado só em teste), **When** a
   verificação roda, **Then** o resultado é quebrado: o novo ponto de partida da cadeia só é aceito quando
   corresponde a um expurgo registrado e ao prazo de 5 anos.
7. **Given** a tabela atual, sem divisão por período, **When** a migração para a estrutura por período roda, **Then**
   todos os registros e a cadeia continuam íntegros e a imutabilidade continua valendo para o perfil da API e para o
   dono do schema.

---

### Edge Cases

- **Trilha vazia**: a verificação de uma trilha sem registros resulta íntegra, com zero verificados; a consulta
  devolve uma página vazia.
- **Registros gravados durante a verificação**: a verificação considera um ponto de corte no início (o último
  registro existente) e não acusa quebra por registros gravados enquanto ela roda.
- **Primeiro registro (gênese)**: a verificação aceita o primeiro registro encadeado ao valor de gênese e acusa
  quebra se ele apontar para outro valor.
- **Ação do catálogo com metadados vazios**: aceita quando a ação não prevê metadados; recusada quando prevê campos
  obrigatórios.
- **Metadados com valores curtos e longos**: as recusas por texto livre valem para textos curtos ("XQZ") e longos, e o
  valor nunca aparece no erro nem no log (lição da feature 001).
- **Navegador muito longo**: o navegador da equipe é truncado em 255 caracteres antes do hash, e a verificação usa o
  valor truncado gravado.
- **Rota pública que tenta informar o ator**: mesmo que uma rota pública passe IP ou identificador por engano, o
  registro sai sem eles (o banco também recusa IP de denunciante).
- **Rota marcada que lança erro depois de iniciar a resposta**: o registro de falha é gravado sem expor o erro
  original.
- **Consulta com período invertido ou limite fora da faixa**: erro de validação com mensagem fixa.
- **Expurgo sem nada a remover**: termina sem erro, registra zero removidos e não altera o ponto de partida da cadeia.
- **Expurgo interrompido**: pode ser repetido; um bloco é removido inteiro ou não é removido.
- **Relógio do servidor adiantado**: o expurgo usa o horário gravado nos registros e uma margem de segurança, e nunca
  remove um bloco cujo registro mais novo tenha menos de 5 anos.
- **Serviço de banco lento durante a verificação**: a verificação pode ser interrompida e repetida; ela não altera
  nenhum registro.

## Requirements _(mandatory)_

### Functional Requirements

**Catálogo de ações e metadados (AUDIT-01, AUDIT-05)**

- **FR-001**: O sistema DEVE manter um catálogo fechado de ações de auditoria, com as ações iniciais listadas na
  AUDIT-01 mais as já gravadas hoje (`USER_CREATED`, `KEYS_REWRAPPED`, `KEYS_REWRAP_RUN`) e a nova `AUDIT_LOG_PURGED`, e um catálogo fechado de
  tipos de recurso.
- **FR-002**: Todo nome de ação DEVE caber no limite de 60 caracteres do campo de ação da trilha, verificado por
  teste.
- **FR-003**: O sistema DEVE recusar o registro de qualquer ação que não esteja no catálogo.
- **FR-004**: Cada ação DEVE ter um formato de metadados próprio, que só aceita os campos previstos para ela, todos
  identificadores, códigos, números, datas ou valores booleanos. Campo não previsto ou texto livre DEVE ser recusado.
- **FR-005**: Uma recusa de registro DEVE gerar erro com mensagem fixa, sem repetir o valor recusado, e nada do valor
  recusado pode aparecer em log, inclusive com valores curtos.
- **FR-006**: Os registros já feitos hoje pelos módulos existentes (criação do administrador e recifragem) DEVEM
  passar a usar o catálogo e os formatos de metadados, sem mudar o que é gravado.

**Contexto do ator (AUDIT-03)**

- **FR-007**: O sistema DEVE determinar o ator de cada registro a partir do contexto em que ele é feito, sem que o
  módulo informe o ator: equipe interna em rotas administrativas autenticadas, denunciante em rotas públicas e
  sistema em jobs e comandos.
- **FR-008**: Para a equipe interna, o registro DEVE ter o identificador do membro, o IP real do cliente (considerando
  o proxy confiável) e o navegador limitado a 255 caracteres.
- **FR-009**: Para o denunciante, o registro NÃO DEVE ter identificador de usuário, IP nem navegador, mesmo que a
  requisição traga cabeçalhos de IP de origem ou de navegador.
- **FR-010**: Para o sistema, o registro NÃO DEVE ter identificador de usuário, IP nem navegador.
- **FR-011**: Se o ator não puder ser determinado, o registro DEVE ser recusado, em vez de gravado com um ator
  adivinhado.
- **FR-012**: O módulo que registra uma ação NÃO DEVE conseguir sobrescrever o ator, o IP ou o navegador determinados
  pelo contexto.

**Auditoria declarativa (AUDIT-04)**

- **FR-013**: O sistema DEVE permitir marcar uma rota com a ação, o tipo de recurso e a forma de obter o identificador
  do recurso, e então registrar sozinho o resultado: sucesso quando a rota termina, negado quando o acesso é recusado
  e falha em qualquer outro erro.
- **FR-014**: O registro de uma rota marcada NÃO DEVE conter o conteúdo da requisição nem da resposta, só o
  identificador do recurso e os metadados previstos para a ação.
- **FR-015**: Se o registro de uma rota marcada falhar, a rota NÃO DEVE entregar o resultado como sucesso: DEVE
  responder com erro genérico (uma leitura de dado sensível sem auditoria viola o princípio V).
- **FR-016**: Operações que alteram dados DEVEM continuar registrando dentro da própria transação, com o mesmo
  catálogo, formatos de metadados e contexto do ator; a marcação de rota é para leituras e casos simples.

**Imutabilidade (AUDIT-08)**

- **FR-017**: A suíte automatizada do CI DEVE provar que o perfil da API não altera nem apaga registros da trilha,
  que o perfil dono do schema não altera, apaga nem esvazia a trilha, e que o banco recusa registro de denunciante com
  IP.

**Consulta (AUDIT-06)**

- **FR-018**: O sistema DEVE permitir ao perfil Auditor consultar a trilha filtrando por ator, ação, tipo de recurso,
  identificador do recurso e período, com paginação por cursor em ordem decrescente.
- **FR-019**: Qualquer outro perfil, ou alguém não autenticado, DEVE receber acesso negado, e a tentativa negada de um
  usuário autenticado DEVE ficar registrada.
- **FR-020**: Toda consulta DEVE ser registrada com os filtros usados, só com identificadores, códigos e datas.
- **FR-021**: Filtros inválidos (ação ou tipo de recurso fora do catálogo, período invertido, limite fora da faixa,
  cursor adulterado) DEVEM gerar erro de validação com mensagem fixa, sem ecoar o valor.
- **FR-022**: A resposta da consulta DEVE proibir cache (feature 001).

**Verificação de integridade (AUDIT-07)**

- **FR-023**: O sistema DEVE verificar a integridade da cadeia recalculando o encadeamento de todos os registros, em
  lotes, sem carregar a trilha inteira na memória.
- **FR-024**: O resultado DEVE informar se a cadeia está íntegra, quantos registros foram verificados e o
  identificador do primeiro registro quebrado, se houver.
- **FR-025**: A verificação DEVE considerar um ponto de corte no início e não acusar quebra por registros gravados
  enquanto roda; ela NÃO DEVE alterar nenhum registro.
- **FR-026**: A verificação DEVE estar disponível ao perfil Auditor por uma rota e a jobs e operadores por um comando
  de linha de comando, que termina com código de saída diferente de zero quando a cadeia está quebrada.
- **FR-027**: Toda verificação DEVE ser registrada com o resultado, a quantidade verificada e o primeiro registro
  quebrado.

**Retenção da trilha (AUDIT-09)**

- **FR-028**: A trilha DEVE ser guardada por 5 anos após o registro. Registros com mais de 5 anos DEVEM ser removidos
  automaticamente, em blocos inteiros por período, nunca registro a registro.
- **FR-029**: A remoção DEVE ser feita por um perfil de manutenção próprio, separado do perfil da API e do dono do
  schema; o perfil da API NÃO DEVE conseguir remover registros nem blocos. Um bloco que ainda contenha registro com
  menos de 5 anos NÃO DEVE ser removido.
- **FR-030**: Cada remoção DEVE ser registrada na trilha com o período removido e a quantidade de registros (ação
  `AUDIT_LOG_PURGED` no catálogo), e a verificação de integridade DEVE aceitar como novo ponto de partida da cadeia
  apenas o primeiro registro restante de um expurgo registrado e coerente com o prazo. Qualquer outra lacuna no início
  ou no meio da cadeia DEVE resultar em quebra.
- **FR-031**: A trilha atual DEVE ser migrada para a estrutura por período sem perder registros, sem quebrar a cadeia
  e mantendo a imutabilidade (perfil da API só insere; ninguém altera ou apaga fora do expurgo). Se o volume de dados
  ainda não justificar blocos menores, a divisão por período pode começar com blocos maiores, desde que o expurgo de 5
  anos funcione.

### Privacy & Security _(mandatory)_

- **Personal or sensitive data handled**: a trilha guarda o identificador do membro da equipe, o IP e o navegador
  dele (necessários para apurar quem acessou dado sensível), o horário exato de todas as ações (D25) e identificadores
  de recursos. Não guarda conteúdo de denúncia, nome de pessoa, texto livre nem dado do denunciante: o catálogo e os
  formatos de metadados recusam qualquer coisa além de identificadores e códigos (FR-004).
- **Anonymity impact**: as rotas públicas passam a registrar ações com ator denunciante sem identificador, IP nem
  navegador, determinados pelo contexto (FR-009, FR-012), com o banco recusando IP de denunciante como última defesa.
  Nenhum filtro da consulta vai no caminho da URL com dado sensível: são só identificadores, códigos e datas. O
  horário exato do denunciante continua gravado (D25), e por isso a leitura é restrita ao Auditor.
- **Encryption**: não há campo cifrado novo. A trilha não guarda conteúdo, por isso não precisa de cifragem por
  campo; a proteção é o catálogo fechado, a imutabilidade e a cadeia de hash.
- **Access**: só o perfil Auditor consulta e verifica a trilha pela API (D25). O perfil da API só insere; ninguém
  altera nem apaga. O comando de verificação roda com acesso de leitura.
- **Audit events**: `AUDIT_LOG_VIEWED` (filtros usados), `AUDIT_CHAIN_VERIFIED` (resultado, quantidade e primeiro
  registro quebrado), `ACCESS_DENIED` nas tentativas negadas, e o catálogo completo da AUDIT-01 para os demais
  módulos. Nenhum metadado com conteúdo.
- **Retention**: os registros da trilha não são afetados pelo expurgo das denúncias (crypto-shredding): eles só têm
  identificadores e continuam válidos depois que o conteúdo da denúncia deixa de existir (o expurgo grava
  `REPORT_SHREDDED`). A própria trilha é guardada por 5 anos após o registro e então removida por período (FR-028 a
  FR-030), por um perfil de manutenção. O prazo precisa ser validado com o jurídico e o DPO e constar no RIPD.

### Key Entities _(include if feature involves data)_

- **Registro de auditoria** (já existe): uma ação, com ator, horário, recurso, resultado, metadados e o encadeamento
  com o registro anterior. Esta feature não muda a estrutura gravada.
- **Ação de auditoria**: um item do catálogo fechado, com o formato de metadados que aceita.
- **Tipo de recurso**: um item do catálogo fechado (por exemplo, denúncia, usuário, chave, trilha).
- **Contexto do ator**: quem está agindo na requisição, job ou comando atual (equipe com identificador, IP e
  navegador; denunciante; sistema). Não é gravado à parte: alimenta cada registro.
- **Resultado da verificação**: se a cadeia está íntegra, quantos registros foram verificados e o primeiro quebrado.
- **Expurgo da trilha**: a remoção de um bloco de período, com o período, a quantidade de registros e o novo ponto de
  partida da cadeia que ele autoriza.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% das tentativas de registrar uma ação fora do catálogo ou metadados fora do formato são recusadas
  nos testes, e em nenhuma delas o valor recusado aparece na resposta ou no log, com valores curtos e longos.
- **SC-002**: Em 100% dos registros feitos a partir de rotas públicas nos testes, o identificador de usuário, o IP e o
  navegador ficam vazios, mesmo com cabeçalhos de IP de origem na requisição.
- **SC-003**: Uma rota marcada gera exatamente um registro por chamada, com o resultado correto (sucesso, negado ou
  falha) em 100% dos casos testados.
- **SC-004**: A suíte do CI falha se qualquer uma das garantias de imutabilidade da trilha deixar de valer.
- **SC-005**: A verificação detecta 100% das adulterações simuladas nos testes (registro alterado e registro
  removido) e aponta o primeiro registro afetado.
- **SC-006**: A verificação de uma trilha com 100.000 registros termina em menos de 1 minuto no ambiente local, com
  uso de memória que não cresce com o tamanho da trilha.
- **SC-007**: Uma consulta do Auditor com filtros devolve a primeira página em menos de 1 segundo numa trilha com
  100.000 registros, no ambiente local.
- **SC-008**: Depois de um expurgo nos testes, 100% dos registros com menos de 5 anos continuam na trilha e a
  verificação resulta íntegra; 100% das remoções feitas por fora do expurgo são detectadas como quebra.

## Assumptions

- **Autenticação e perfis ainda não existem** (AUTH-06, ACL-01, ACL-02): a identidade do membro da equipe e o perfil
  Auditor vêm das features de autenticação e controle de acesso. Nesta feature, o contexto do ator e as rotas do
  Auditor são construídos contra um ponto de extensão que essas features vão preencher; nos testes, uma identidade
  simulada (só em teste) faz o papel do usuário autenticado. Até a autenticação existir, as rotas de consulta e de
  verificação ficam negadas para todos em produção (negado por padrão, princípio IV), e a verificação fica disponível
  pelo comando de linha de comando. As user stories 5 e 6 fecham nesta feature com essa identidade de teste; a ligação
  com o login real é uma tarefa da feature de autenticação.
- **Ação `ACCESS_DENIED` em rotas não marcadas**: o registro de acesso negado por falta de permissão em qualquer rota
  administrativa depende do controle de acesso (ACL); nesta feature, ele é feito nas rotas marcadas e nas rotas do
  Auditor.
- **Paginação por cursor** reaproveita o padrão da feature 001 (TRV-08), ordenando por identificador decrescente.
- **Desempenho**: as metas de SC-006 e SC-007 valem para o ambiente local; no CI, os valores são medidos e
  registrados, sem falhar o build por tempo (mesmo critério da feature 002).
- **Prazo de guarda**: os 5 anos foram decididos pelo usuário em 2026-11-28. O prazo ainda precisa ser validado com o
  jurídico e o DPO e registrado no RIPD; mudar o prazo depois é uma alteração de configuração, não de estrutura.
- **Expurgo e backups**: o expurgo remove os registros da base ativa; cópias em backup seguem a D26 (backups por tempo
  indeterminado) e não são alcançadas, o que também precisa constar no RIPD.
- **Fora do escopo**: alertas automáticos quando a verificação falha (o comando só devolve o código de saída), tela do
  Auditor no front (feature 10 do backlog do front) e exportação da trilha.
