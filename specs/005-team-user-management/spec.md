# Feature Specification: Gestão da equipe interna e meu perfil

**Feature Branch**: `main` (nenhuma branch criada: não há hook `before_specify` registrado)

**Created**: 2026-11-28

**Status**: Draft

**Input**: User description: "Primeira tarefa do passo 4 ('Equipe interna') da ordem do backlog:
`docs/tarefas/03-users.md`. Os IDs USERS-xx, os critérios de aceite (inclusive as propostas do front registradas no
USERS-07: permissões efetivas no formato `recurso.ação` e horários de expiração da sessão em `/me`) e as decisões D20,
D21, D47, D53, D54 e o ADR 0053 valem como requisitos. Considerar o que já existe: USERS-01 (entregue na 001 com o
create-admin), as entidades, os stores, a ponte de sessão, os guards e o `OpenAdminRoute` da 004, o catálogo de
auditoria e o ator por contexto da 003. Não reespecificar o que existe. Dependências de AUTH ou ACL ainda não
implementadas entram como premissa, dizendo como a feature fecha sem elas. O front consome `/me` e as rotas de
usuários: o contrato precisa sair compatível com o backlog."

## Escopo

A feature entrega a gestão da equipe interna pelo Administrador (criar, listar, detalhar, alterar dados, status e
perfis, resetar o MFA de outra pessoa) e a rota "meu perfil", que o backoffice usa para montar menu, rotas e avisos de
expiração da sessão.

**Tarefas do backlog cobertas**: USERS-02 a USERS-07. USERS-01 já foi entregue (feature 001) e é só referenciado.

**O que já existe e não é reespecificado**:

- **Repositório de usuários (USERS-01, D33)**: leitura sem hash nem segredo de MFA, e-mail único tratado pela
  constraint (409), contagem de Administradores ativos, criação com perfis. O comando `create-admin` cria o primeiro
  Administrador.
- **Autenticação (D53, feature 004)**: sessão por cookie no servidor, guard global, `@AdminApi` exigindo sessão com
  MFA verificado, usuário e perfis relidos do banco a cada requisição (só `ACTIVE` entra), encerramento de todas as
  sessões de um usuário, remoção do MFA pelo pacote, ponte com a identidade da auditoria (D47).
- **Autorização (D54, feature 004)**: negação por padrão, regras por rota e no serviço, negações gravadas como
  `ACCESS_DENIED`; mapeamento da matriz do ACL-01 no ADR 0053.
- **Auditoria (feature 003)**: catálogo fechado de ações (já tem `USER_CREATED`, `USER_UPDATED`,
  `USER_STATUS_CHANGED`, `USER_ROLES_CHANGED`, `USER_MFA_RESET`), metadata validada por schema e ator vindo do
  contexto da requisição.

**Premissas sobre o que ainda não existe** (a feature fecha sem elas):

- **Login real (AUTH-01 a AUTH-05)**: ainda não há rotas reais de login, cadastro de MFA nem troca de senha. As rotas
  desta feature já exigem a sessão real; nos testes, a sessão vem do login de exemplo da feature 004 (só de teste).
  O uso em produção começa quando o AUTH-01 a AUTH-04 entrarem. A troca obrigatória da senha provisória e o cadastro
  do MFA no primeiro acesso são do AUTH-03 e do AUTH-05: aqui, só se marca a obrigação no cadastro e se informa no
  `/me`.
- **Matriz completa de permissões (ACL-01 a ACL-05)**: esta feature cria apenas as regras da área de usuários (só o
  Administrador gerencia a equipe; ninguém age sobre si mesmo nas operações listadas). As demais habilidades da matriz
  são aplicadas pelas features de access-control e de domínio. O perfil já devolve o catálogo completo de códigos da
  matriz (Q2).
- **Denúncias (domínio, passo 5)**: o módulo de denúncias ainda não existe, mas a tabela e a atribuição a um analista
  já existem no banco; a regra do USERS-04 sobre denúncias atribuídas usa essa atribuição (Q1).

## Clarifications

### Session 2026-11-28

- Q: O que fazer com as denúncias atribuídas quando um Analista é desativado ou perde o perfil de Analista? → A:
  recusar com 409, informando a quantidade, até o Gestor reatribuir; bloquear continua sempre permitido e imediato
  (Q1 = A).
- Q: Quais códigos de permissão o perfil devolve nesta feature? → A: o catálogo completo da matriz do ACL-01, calculado
  pelos perfis atuais (Q2 = A).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Cadastrar e consultar a equipe (Priority: P1)

O Administrador cadastra uma pessoa da equipe com nome, e-mail e perfis e recebe uma senha provisória forte, mostrada
uma única vez, para entregar à pessoa por um canal seguro. Ele lista a equipe com filtros e paginação e abre o detalhe
de cada pessoa, sem nunca ver hash de senha nem segredo de MFA.

**Why this priority**: sem cadastro, só existe o Administrador criado pelo comando; ninguém mais pode trabalhar no
canal.

**Independent Test**: com uma sessão de Administrador, criar uma pessoa, conferir a resposta com a senha provisória,
listar e detalhar; conferir a trilha e que a senha provisória não aparece em log nem na auditoria.

**Acceptance Scenarios**:

1. **Given** um Administrador com sessão verificada, **When** ele cadastra nome, e-mail e perfis válidos, **Then** a
   pessoa é criada ativa, com a troca de senha obrigatória, e a resposta traz a senha provisória uma única vez.
2. **Given** a pessoa criada, **When** o detalhe é consultado de novo, **Then** a senha provisória não aparece mais em
   lugar nenhum.
3. **Given** um e-mail já cadastrado (com qualquer diferença de maiúsculas), **When** o cadastro é tentado, **Then** a
   resposta é 409.
4. **Given** um cadastro, **When** a trilha é consultada, **Then** há um `USER_CREATED` com o Administrador como ator
   e só os perfis na metadata; nem a senha provisória nem o e-mail aparecem na trilha ou nos logs.
5. **Given** 30 pessoas, **When** o Administrador lista com filtro de status ou perfil e tamanho de página 10, **Then**
   recebe só as que casam com o filtro, em páginas por cursor, com `mfaEnabled` e `lastLoginAt` e sem hash nem segredo.
6. **Given** uma pessoa com outro perfil (por exemplo, Analista), **When** ela tenta cadastrar, listar ou detalhar a
   equipe, **Then** recebe 403 e a negação vai para a trilha.

---

### User Story 2 - Meu perfil para o backoffice (Priority: P1)

Qualquer pessoa da equipe com sessão verificada consulta o próprio perfil: quem é, seus perfis, se tem MFA, se precisa
trocar a senha, a lista de permissões efetivas em códigos estáveis `recurso.ação` e os horários em que a sessão expira
por inatividade e pelo limite absoluto. O backoffice decide menu e rotas só por essas permissões e avisa antes de cada
expiração.

**Why this priority**: o front do backoffice está sendo especificado agora e depende deste contrato para montar a
navegação e os avisos de sessão.

**Independent Test**: entrar com perfis diferentes e comparar as permissões devolvidas com a matriz; avançar o relógio
e conferir os horários de expiração.

**Acceptance Scenarios**:

1. **Given** uma pessoa com sessão verificada, **When** ela consulta o próprio perfil, **Then** recebe id, nome,
   e-mail, perfis, situação do MFA, se a troca de senha é obrigatória, permissões efetivas e os dois horários de
   expiração em ISO 8601 UTC.
2. **Given** um Administrador e um Auditor, **When** cada um consulta o perfil, **Then** o Administrador recebe
   `users.manage` e não recebe `audit.read`; o Auditor recebe `audit.read` e não recebe `users.manage`.
3. **Given** uma pessoa que perdeu um perfil, **When** ela consulta o perfil na requisição seguinte, **Then** as
   permissões já refletem a perda.
4. **Given** uma sessão iniciada às 12:00 e usada pela última vez às 12:10, **When** o perfil é consultado às 12:10,
   **Then** a expiração por inatividade é por volta de 12:25 (nunca depois) e a absoluta é 20:00.
5. **Given** nenhuma sessão, **When** o perfil é consultado, **Then** a resposta é 401.

---

### User Story 3 - Alterar dados, status e perfis com segregação (Priority: P1)

O Administrador corrige o nome de uma pessoa, bloqueia, desativa ou reativa contas e altera perfis. Bloquear ou
desativar tira o acesso na hora. Ninguém altera os próprios perfis nem o próprio status, e o sistema nunca fica sem um
Administrador ativo.

**Why this priority**: tirar o acesso de quem saiu da empresa ou de uma conta comprometida é um controle de segurança
essencial, e a segregação impede que um Administrador se dê acesso às denúncias sozinho (D21).

**Independent Test**: com duas sessões (Administrador e a pessoa alvo), bloquear a pessoa e conferir 401 na requisição
seguinte dela; tentar alterar os próprios perfis e status; tentar retirar o último Administrador ativo.

**Acceptance Scenarios**:

1. **Given** uma pessoa com sessão aberta, **When** o Administrador a bloqueia ou desativa, **Then** todas as sessões
   dela deixam de valer na requisição seguinte e a trilha registra `USER_STATUS_CHANGED` com status anterior e novo.
2. **Given** uma pessoa bloqueada ou desativada, **When** o Administrador a reativa, **Then** ela volta a poder entrar
   (nenhuma sessão antiga é restaurada).
3. **Given** um Administrador, **When** ele tenta alterar os próprios perfis ou o próprio status, **Then** recebe 403
   e a negação vai para a trilha.
4. **Given** exatamente dois Administradores ativos, **When** cada um tenta, ao mesmo tempo, retirar o perfil ou
   bloquear o outro, **Then** só uma operação passa, a outra é recusada (403 ou 409) e sempre sobra ao menos um
   Administrador ativo. Uma operação isolada nunca zera os Administradores (quem age já é um Administrador ativo e não
   age sobre si); a recusa com 409 `LAST_ACTIVE_ADMIN` é a defesa da própria operação e é provada direto no serviço.
5. **Given** uma alteração de perfis, **When** ela é concluída, **Then** vale na requisição seguinte da pessoa e a
   trilha registra `USER_ROLES_CHANGED` com os perfis antes e depois.
6. **Given** um Administrador, **When** ele adiciona a si mesmo um perfil que lê denúncias por outra conta de
   Administrador, **Then** a operação é permitida (D21: o Administrador pode acumular perfis que leem denúncias, desde
   que concedidos por outra pessoa).
7. **Given** um Analista com denúncias atribuídas, **When** o Administrador o desativa ou lhe retira o perfil de
   Analista, **Then** a operação é recusada (409, com a quantidade de denúncias atribuídas); bloqueá-lo continua
   permitido e imediato.

---

### User Story 4 - Resetar o MFA de outra pessoa (Priority: P2)

Quem perdeu o celular pede ao Administrador o reset do MFA. O Administrador apaga o autenticador e os códigos de
recuperação da pessoa e encerra as sessões dela; no próximo acesso, ela cadastra um novo autenticador.

**Why this priority**: sem isso, uma pessoa que perde o autenticador e os códigos fica sem acesso; é menos frequente
que as operações da P1.

**Independent Test**: com uma pessoa com MFA ativo e sessão aberta, resetar e conferir que a sessão caiu, que não há
mais autenticador nem códigos e que a trilha registrou `USER_MFA_RESET`.

**Acceptance Scenarios**:

1. **Given** uma pessoa com MFA ativo e sessão aberta, **When** o Administrador reseta o MFA dela, **Then** o
   autenticador e os códigos de recuperação deixam de existir, as sessões dela caem e a trilha registra
   `USER_MFA_RESET`.
2. **Given** um Administrador, **When** ele tenta resetar o próprio MFA por esta operação, **Then** recebe 403.
3. **Given** uma pessoa sem MFA cadastrado, **When** o reset é pedido, **Then** a operação termina sem erro
   (idempotente) e é registrada.

---

### Edge Cases

- E-mail com espaços nas pontas é normalizado (espaços removidos; maiúsculas indiferentes para a unicidade); formato
  inválido é recusado com 400, sem repetir o valor na mensagem.
- Cadastro sem nenhum perfil, com perfil repetido ou inexistente: 400.
- Corpo com campos extras (por exemplo, tentar definir status, senha ou MFA no cadastro): 400.
- Pessoa inexistente nas operações por id: 404; id malformado: 400.
- Alteração de status ou de perfis para o valor atual: sem efeito e sem registro na trilha, sem erro (200).
- Pessoa bloqueada pelo bloqueio progressivo de login (bloqueio temporário) não é o mesmo que o status "bloqueado"
  definido pelo Administrador; esta feature só trata o status.
- Administrador que perde o próprio perfil de Administrador por ação de outro: perde o acesso às rotas de equipe na
  requisição seguinte.
- Duas alterações simultâneas de perfis da mesma pessoa: a trilha registra as duas na ordem em que foram aplicadas, e o
  estado final é o da última.
- Paginação com cursor inválido ou adulterado: 400.
- Senha provisória: nunca repetida em log, auditoria, mensagem de erro ou resposta posterior, inclusive quando o
  cadastro falha depois de gerada.

## Requirements _(mandatory)_

### Functional Requirements

**Cadastro e consulta (USERS-02, USERS-03)**

- **FR-001**: O Administrador DEVE poder cadastrar uma pessoa com nome, e-mail e um ou mais perfis entre os cinco do
  sistema.
- **FR-002**: O cadastro DEVE gerar uma senha provisória forte, devolvida uma única vez na resposta do cadastro e
  nunca mais recuperável; a pessoa nasce ativa, sem MFA e com a troca de senha obrigatória.
- **FR-003**: A senha provisória e o e-mail NÃO PODEM aparecer em logs, na trilha de auditoria nem em mensagens de
  erro.
- **FR-004**: O e-mail DEVE ser único sem diferenciar maiúsculas; duplicidade responde 409.
- **FR-005**: O Administrador DEVE poder listar a equipe com filtro por status e por perfil, paginada por cursor, e
  detalhar uma pessoa; as respostas trazem id, nome, e-mail, perfis, status, se o MFA está ativo, último login e
  datas de criação e atualização, e nunca hash de senha, segredo de MFA ou códigos de recuperação.
- **FR-006**: O último login DEVE ser atualizado quando a pessoa conclui a entrada (senha e MFA).

**Dados, status e perfis (USERS-04, USERS-05)**

- **FR-007**: O Administrador DEVE poder alterar o nome de uma pessoa (registrado como `USER_UPDATED`, sem o nome na
  metadata).
- **FR-008**: O Administrador DEVE poder mudar o status de uma pessoa entre ativo, bloqueado e desativado; nenhuma
  pessoa é apagada.
- **FR-009**: Bloquear ou desativar DEVE encerrar todas as sessões da pessoa na hora; a requisição seguinte dela
  recebe 401.
- **FR-010**: O Administrador NÃO PODE alterar o próprio status nem os próprios perfis (403, registrado como
  negação); a mudança precisa ser feita por outro Administrador (D21).
- **FR-011**: Nenhuma operação PODE deixar o sistema sem Administrador ativo (retirar o perfil, bloquear ou desativar
  o último): a contagem e a alteração acontecem juntas, de modo que operações simultâneas não contornem a regra
  (409 `LAST_ACTIVE_ADMIN`). Pela API, a situação só surge com operações simultâneas; o caso isolado é provado no
  serviço.
- **FR-011a**: Quem age DEVE ser conferido de novo dentro da transação: se deixou de estar ativo ou de ser
  Administrador desde o início da requisição, a operação é recusada (403) e nada muda.
- **FR-012**: O Administrador DEVE poder definir o conjunto de perfis de uma pessoa, inclusive acumulando o perfil de
  Administrador com perfis que leem denúncias (D21); a mudança vale na requisição seguinte.
- **FR-013**: Desativar um Analista com denúncias atribuídas, ou retirar dele o perfil de Analista, DEVE ser recusado
  (409, informando a quantidade de denúncias atribuídas) até o Gestor reatribuí-las; bloquear o mesmo Analista é sempre
  permitido e tira o acesso na hora, sem mexer nas atribuições.
- **FR-014**: Mudanças de status e perfis DEVEM ser registradas (`USER_STATUS_CHANGED` com status anterior e novo;
  `USER_ROLES_CHANGED` com perfis antes e depois), na mesma transação da alteração.

**Reset do MFA (USERS-06)**

- **FR-015**: O Administrador DEVE poder resetar o MFA de outra pessoa: o autenticador e os códigos de recuperação são
  apagados e as sessões dela encerradas; o próximo acesso exige novo cadastro do MFA (AUTH-03).
- **FR-016**: O Administrador NÃO PODE resetar o próprio MFA por esta operação (403).
- **FR-017**: O reset DEVE ser registrado como `USER_MFA_RESET`.

**Meu perfil (USERS-07)**

- **FR-018**: Qualquer pessoa da equipe com sessão verificada DEVE poder consultar o próprio perfil: id, nome,
  e-mail, perfis, se o MFA está ativo e se a troca de senha é obrigatória. Sem sessão: 401.
- **FR-019**: O perfil DEVE trazer as permissões efetivas como códigos estáveis `recurso.ação` (por exemplo
  `users.manage`, `audit.read`, `reports.list`, `reports.read`), calculadas no servidor a partir dos perfis atuais;
  habilidade que depende do registro indica só que a pessoa pode exercê-la em algum registro. O catálogo de códigos
  devolvido é o completo da matriz do ACL-01, já nesta feature, mantido numa fonte única que as regras do servidor
  também usam.
- **FR-020**: O perfil DEVE trazer os horários de expiração da sessão atual em ISO 8601 UTC: por inatividade (último
  uso registrado + 15 min, podendo vir até 1 min antes do real, nunca depois) e absoluta (início da sessão + 8 h).
- **FR-021**: A consulta ao perfil NÃO É auditada (não contém dado de denúncia) e conta como uso da sessão, como
  qualquer requisição autenticada.

**Acesso (D54)**

- **FR-022**: Todas as operações de equipe (FR-001 a FR-017) DEVEM ser exclusivas do Administrador e declarar sua
  regra de permissão; qualquer outro perfil recebe 403, registrado como `ACCESS_DENIED`.
- **FR-023**: Toda entrada DEVE ser validada com rejeição de campos extras e limites de tamanho; mensagens de erro não
  repetem os valores recebidos.

### Privacy & Security _(mandatory)_

- **Personal or sensitive data handled**: nome e e-mail profissional da equipe interna (necessários para identificar
  quem trata as denúncias e para o login), perfis, status, datas de último login e de troca de senha, e a senha
  provisória (só em trânsito, na resposta do cadastro). Nenhum dado de denunciante ou de denúncia.
- **Anonymity impact**: nenhuma rota pública é tocada; todas as rotas são administrativas. Nenhum dado pessoal vai no
  caminho da URL (só o id da pessoa, um UUID).
- **Encryption**: nenhum campo novo cifrado. O segredo de MFA (já selado pelo Vault com a `app-kek`, feature 004) é
  apagado no reset, nunca lido nem devolvido. Senhas só como hash (D32); a senha provisória nunca é guardada em claro.
- **Access**: só o Administrador gerencia a equipe; ninguém altera os próprios perfis, status ou MFA por estas
  operações (D21); sempre há um Administrador ativo. O próprio perfil é visível só para a própria pessoa. Escopo por
  atribuição e conflito de interesse não se aplica a dados da equipe.
- **Audit events**: `USER_CREATED` (perfis), `USER_UPDATED` (sem o nome), `USER_STATUS_CHANGED` (status anterior e
  novo), `USER_ROLES_CHANGED` (perfis antes e depois), `USER_MFA_RESET`, `ACCESS_DENIED` nas negações; ator sempre o
  Administrador da sessão (contexto, D46/D47). Nunca senha, e-mail, nome ou segredo na metadata.
- **Retention**: dados da equipe não são cripto-fragmentados com as denúncias; pessoas nunca são apagadas, só
  desativadas, para que a trilha continue apontando para quem agiu.

### Key Entities

- **Pessoa da equipe (usuário)**: nome, e-mail único, status (ativo, bloqueado, desativado), situação do MFA, se a
  troca de senha é obrigatória, último login. Já existe (USERS-01).
- **Perfil**: um dos cinco perfis do sistema; uma pessoa tem um ou mais. Já existe.
- **Sessão**: a sessão atual da pessoa, com início, último uso e limites de expiração. Já existe (feature 004); aqui é
  só lida (expirações) e encerrada.
- **Permissão efetiva**: código `recurso.ação` derivado dos perfis atuais; não é guardado, é calculado a cada
  consulta.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: O Administrador cadastra uma pessoa e entrega a senha provisória em menos de 1 minuto, e a senha não
  aparece em nenhum log nem registro da trilha (verificado com textos longos e curtos).
- **SC-002**: Uma pessoa bloqueada ou desativada perde o acesso em 100% dos casos na primeira requisição seguinte, sem
  esperar a expiração da sessão.
- **SC-003**: Em nenhuma combinação de operações, inclusive simultâneas, o sistema fica sem Administrador ativo.
- **SC-004**: Nenhuma pessoa consegue alterar os próprios perfis, status ou MFA pelas operações de equipe; 100% das
  tentativas são negadas e registradas.
- **SC-005**: Para cada um dos cinco perfis e combinações deles, as permissões do perfil coincidem com o que o servidor
  permite fazer nas rotas desta feature e nas já existentes.
- **SC-006**: Os horários de expiração informados nunca são posteriores à expiração real, e a diferença para a
  expiração real por inatividade é de no máximo 1 minuto.
- **SC-007**: O front do backoffice consegue montar menu, rotas e avisos de sessão só com a resposta do perfil, sem
  conhecer a matriz de perfis.

## Assumptions

- O login real (AUTH-01 a AUTH-05) vem depois; nos testes, a sessão é obtida pelo login de exemplo da feature 004. As
  regras de primeiro acesso (troca da senha provisória e cadastro do MFA) são aplicadas pelo AUTH-03 e pelo AUTH-05;
  esta feature apenas marca e informa a obrigação.
- A política de senha (AUTH-05) ainda não existe; a senha provisória é gerada pelo sistema com força bem acima do
  mínimo previsto (12 caracteres, aleatória), então não depende dela.
- A entrega da senha provisória à pessoa é feita pelo Administrador por canal seguro fora do sistema; não há envio de
  e-mail nesta feature (notificações vêm depois).
- Status "bloqueado" e "desativado" são reversíveis pelo Administrador; a diferença é de intenção (bloqueio
  temporário, por exemplo conta suspeita, versus desligamento). Ambos tiram o acesso na hora.
- Os perfis em pendência de login (sessão com MFA pendente, troca de senha obrigatória) não consultam o perfil por
  esta rota; a próxima etapa do login é informada pelas respostas do login (premissa de contrato do AUTH-01 a
  AUTH-04).
- As regras da área de usuários são as primeiras políticas reais do sistema; o padrão segue o ADR 0053 e as demais
  linhas da matriz ficam para o access-control.
- A operação de listagem segue a paginação por cursor já existente no projeto (sem deslocamento por número de
  página).
