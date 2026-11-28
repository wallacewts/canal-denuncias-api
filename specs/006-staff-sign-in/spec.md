# Feature Specification: Login da equipe, MFA, senha e sessões

**Feature Branch**: `main` (nenhuma branch criada: não há hook `before_specify` registrado)

**Created**: 2026-11-28

**Status**: Draft

**Input**: User description: "Próxima tarefa do passo 4 ('Equipe interna') da ordem do backlog:
`docs/tarefas/04-auth.md`, do AUTH-01 em diante (o AUTH-00 foi feito na feature 004). Os IDs, os critérios de aceite
(inclusive as propostas do front já registradas: `nextStep` em código, 423 no desafio de MFA, 422 com código na troca
de senha incluindo `CURRENT_PASSWORD_INVALID`, limite de 5 erros de senha atual com 429 e encerramento da sessão, QR
code PNG embutido, códigos de recuperação uma única vez, horários de expiração nas respostas, resposta genérica no
bloqueio da etapa da senha) e as decisões D21, D25, D46, D47, D53, D55, D56 e o ADR 0053 valem como requisitos. O que
já existe (stores, ponte de sessão, guards, `OpenAdminRoute`, `session-policy.ts`, catálogo de habilidades, `/me`,
usuários, auditoria por contexto) só é referenciado. O login de exemplo da 004 em `test/` vira código definitivo. O
contrato precisa bater com o que o front implementou contra o simulador
(`canal-denuncias-web/specs/004-backoffice-sign-in/contracts/auth-api.md`); divergências viram perguntas."

## Escopo

A feature entrega o login real da equipe no backoffice: entrada com senha, desafio do segundo fator, primeiro acesso
(troca da senha provisória e cadastro do autenticador), troca de senha, saída e gestão das próprias sessões, proteção
contra requisições de outra origem e limite de tentativas nas rotas de entrada.

**Tarefas do backlog cobertas**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-07, AUTH-08 e o critério que falta
no AUTH-06 (teste do fluxo inteiro). Fecha também o critério aberto do USERS-02 (troca obrigatória e cadastro do MFA
no primeiro login).

**O que já existe e não é reespecificado**:

- **Sessão e segundo fator (D53, feature 004)**: sessão por cookie no servidor com 15 min sem uso e 8 h no máximo,
  id trocado no login e no MFA, stores definitivos no Postgres (sessões, segredo TOTP selado pelo Vault, último passo
  usado, códigos de recuperação consumidos ao usar, falhas de MFA com bloqueio de 5 em 15 min), tempos da sessão numa
  fonte única, rotas administrativas que exigem MFA verificado, abertura das rotas de entrada antes da sessão
  completa, eventos de entrada, falha de MFA e saída gravados na trilha.
- **Equipe e perfil (feature 005)**: cadastro com senha provisória e troca obrigatória marcada, status relido a cada
  requisição, `GET /me` com perfis, habilidades e horários de expiração, catálogo de habilidades (D55), erros com
  código (D56), revogação das sessões de uma pessoa.
- **Política de senha e hash (D32, feature 001)**: mínimo de 12 caracteres, recusa de senhas comuns por lista local,
  hash scrypt do pacote oficial.
- **Auditoria (feature 003)**: catálogo fechado, ator pelo contexto da requisição (D46, D47), horário exato (D25).
- **Login de exemplo da feature 004 (só em `test/`)**: as rotas de exemplo provaram o comportamento; aqui elas viram
  rotas definitivas e o exemplo deixa de ser necessário para os testes das features seguintes.

## Clarifications

### Session 2026-11-28

- Q: Que código responder para código errado na confirmação do cadastro? → A: 422 `MFA_CODE_INVALID` na confirmação
  **e** no desafio do login; 401 passa a significar só sessão ausente ou expirada em todo o fluxo (Q1 = A).
- Q: Quando a pessoa já tem autenticador e precisa trocar a senha, qual etapa vem primeiro? → A: o segundo fator,
  depois a troca; o primeiro acesso sem autenticador continua troca e depois cadastro (Q2 = A).
- Q: Incluir o código `PASSWORD_SAME_AS_CURRENT`? → A: sim.
- O front ajusta o contrato e o simulador (inclusive o 423 sem "a confirmar"); o nome do cookie (`__Host-sid`) fica
  como está.
- Q (plano, R11): o que as outras rotas administrativas respondem com sessão verificada e troca obrigatória
  pendente? → A: 403 `PASSWORD_CHANGE_REQUIRED`; liberadas só a troca de senha, a saída e o `GET /me` (com
  `passwordChangeRequired: true`).
- Q (analyze, I1): o que responde uma rota de etapa chamada fora da etapa? → A: 403 `STEP_NOT_ALLOWED`; 401 só
  para sessão ausente ou expirada.
- Números de bloqueio e limite aprovados (15 min após 5 falhas, dobrando até 24 h; 20/min por IP; 10 a cada 15 min por
  conta), configuráveis no servidor com esses padrões.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Entrar com senha e segundo fator (Priority: P1)

Uma pessoa da equipe informa e-mail e senha. Se a senha confere, a resposta diz qual é a próxima etapa (segundo fator,
cadastro do autenticador, troca de senha ou concluído) e traz os horários de expiração da sessão. No desafio, ela
informa o código do autenticador ou um código de recuperação e a sessão passa a valer para a área administrativa. Quem
erra, quem não existe e quem está bloqueado recebem sempre a mesma resposta genérica, no mesmo tempo.

**Why this priority**: sem login real, ninguém usa o backoffice; todas as rotas administrativas dependem disso.

**Independent Test**: com uma pessoa já com autenticador, fazer o fluxo inteiro (senha, código, rota protegida, saída,
rota protegida de novo com 401) e os casos de erro, conferindo respostas, tempos e trilha.

**Acceptance Scenarios**:

1. **Given** uma pessoa ativa com autenticador cadastrado, **When** ela entra com e-mail e senha corretos, **Then**
   recebe 200 com a próxima etapa `MFA_REQUIRED`, os horários de expiração e um cookie de sessão que ainda não abre
   as rotas administrativas.
2. **Given** a sessão pendente, **When** ela informa um código válido do autenticador (passo atual ou um passo de
   tolerância), **Then** recebe 200 com `DONE`, os horários de expiração e um cookie **novo**; o cookie anterior deixa
   de valer; a trilha registra a entrada.
3. **Given** a sessão pendente, **When** ela informa um código de recuperação ainda não usado, **Then** entra do mesmo
   jeito e esse código não vale mais; a trilha registra o uso do código de recuperação.
4. **Given** um código já aceito antes, ou um código errado, **When** ele é informado, **Then** recebe 422
   `MFA_CODE_INVALID` e a sessão pendente continua.
5. **Given** e-mail inexistente, senha errada, conta bloqueada, desativada ou em bloqueio temporário, **When** a
   pessoa tenta entrar, **Then** recebe sempre a mesma resposta 401 genérica, em tempo equivalente, e o motivo real
   fica só na trilha.
6. **Given** 5 falhas seguidas de senha (ou de código, depois da senha) na mesma conta, **When** ela tenta de novo,
   **Then** a conta fica em bloqueio temporário de 15 min (com a mesma resposta genérica na etapa da senha); cada nova
   série de 5 falhas dobra o tempo; uma entrada completa zera o contador.
7. **Given** 5 códigos errados no desafio em 15 min, **When** ela tenta o sexto, **Then** recebe 423, distinto do
   código inválido (422) e do limite de tentativas (429).
8. **Given** uma pessoa com autenticador que também precisa trocar a senha, **When** ela entra com a senha, **Then**
   a próxima etapa é `MFA_REQUIRED`; depois do desafio, `PASSWORD_CHANGE_REQUIRED` (Q2).
9. **Given** a pessoa dentro, **When** ela sai, **Then** recebe 204, o cookie é apagado e a mesma requisição
   protegida dá 401.
10. **Given** um hash de senha antigo (custo menor que o atual), **When** a pessoa entra com a senha correta, **Then**
    o hash é refeito com o custo atual.

---

### User Story 2 - Primeiro acesso: trocar a senha provisória e cadastrar o autenticador (Priority: P1)

Quem foi cadastrado pelo Administrador entra com a senha provisória, troca a senha e cadastra o autenticador lendo um
QR code (ou digitando o segredo). Ao confirmar com um código, recebe 10 códigos de recuperação, mostrados uma única
vez, e passa a ter acesso à área administrativa. Antes disso, nenhuma outra rota administrativa abre.

**Why this priority**: sem isso, ninguém além do primeiro Administrador consegue começar a trabalhar.

**Independent Test**: criar uma pessoa pelo cadastro da feature 005, seguir o fluxo inteiro e conferir que cada
etapa só libera a seguinte.

**Acceptance Scenarios**:

1. **Given** uma pessoa recém-cadastrada (troca obrigatória e sem autenticador), **When** ela entra com a senha
   provisória, **Then** a próxima etapa é `PASSWORD_CHANGE_REQUIRED`.
2. **Given** essa sessão, **When** ela troca a senha com sucesso, **Then** recebe 200 com a próxima etapa
   `MFA_ENROLLMENT_REQUIRED`, os horários de expiração e um cookie novo.
3. **Given** a etapa de cadastro, **When** ela pede o cadastro do autenticador, **Then** recebe a URI de configuração,
   o QR code como imagem PNG embutida e o segredo em texto, com o nome do sistema como emissor; nada disso vai para
   log ou trilha.
4. **Given** o cadastro gerado, **When** ela confirma com um código válido, **Then** recebe os 10 códigos de
   recuperação (uma única vez), a próxima etapa `DONE`, os horários e um cookie novo; a trilha registra o cadastro.
5. **Given** o cadastro gerado, **When** ela confirma com um código errado, **Then** recebe 422 `MFA_CODE_INVALID` e
   o cadastro continua pendente (Q1).
6. **Given** qualquer etapa antes de `DONE`, **When** ela tenta outra rota administrativa (inclusive `/me`), **Then**
   recebe 401 (sessão não verificada).

---

### User Story 3 - Trocar a senha (Priority: P1)

A pessoa troca a própria senha informando a atual e a nova. A nova precisa seguir a política. Senha atual errada não
encerra a sessão até o quinto erro, que encerra. Trocar a senha encerra as outras sessões e troca o id da atual.

**Why this priority**: é parte do primeiro acesso e uma defesa básica de conta; o front já tem a tela pronta.

**Independent Test**: com uma sessão verificada e outra aberta em paralelo, trocar a senha e conferir as duas; errar a
senha atual 5 vezes.

**Acceptance Scenarios**:

1. **Given** uma sessão verificada e outra sessão da mesma pessoa, **When** ela troca a senha corretamente, **Then**
   recebe 200 com a próxima etapa, os horários e um cookie novo; a outra sessão deixa de valer; a trilha registra a
   troca.
2. **Given** uma senha nova curta ou comum, **When** ela tenta trocar, **Then** recebe 422 com o código da regra
   (`PASSWORD_TOO_SHORT` ou `PASSWORD_COMMON`), sem a senha na resposta, no log ou na trilha; o erro de política não
   conta para o limite.
3. **Given** a senha atual errada, **When** ela tenta trocar pela 1ª à 4ª vez na mesma sessão, **Then** recebe 422
   `CURRENT_PASSWORD_INVALID` e a sessão continua; cada erro é registrado com a tentativa.
4. **Given** 4 erros de senha atual, **When** ela erra a 5ª vez, **Then** recebe 429, a sessão é encerrada (cookie
   apagado) e a requisição seguinte dá 401; o registro marca o bloqueio.
5. **Given** 5 requisições simultâneas com a senha atual errada, **When** elas chegam juntas, **Then** a sessão é
   encerrada uma única vez e nenhuma passa do limite.
6. **Given** uma sessão nova depois do encerramento, **When** ela erra a senha atual, **Then** o contador começa do
   zero.

---

### User Story 4 - Ver e encerrar as próprias sessões (Priority: P2)

A pessoa vê onde está conectada (criação, último uso, IP e navegador), com a sessão atual marcada, encerra uma sessão
específica ou todas.

**Why this priority**: controle útil e previsto no backlog, mas o backoffice ainda não tem a tela.

**Independent Test**: abrir duas sessões, listar, encerrar uma e depois todas.

**Acceptance Scenarios**:

1. **Given** duas sessões da pessoa, **When** ela lista, **Then** vê as duas com criação, último uso, IP e navegador,
   e a atual marcada; nunca vê o identificador secreto do cookie.
2. **Given** a lista, **When** ela encerra a outra sessão, **Then** essa deixa de valer e a atual continua.
3. **Given** duas sessões, **When** ela encerra todas, **Then** nenhuma vale mais e a trilha registra o encerramento
   de todas.
4. **Given** uma sessão de outra pessoa, **When** ela tenta encerrá-la, **Then** recebe 404 (não revela que existe).

---

### User Story 5 - Proteções do navegador e limite de tentativas (Priority: P2)

Requisições que alteram dados na área administrativa só são aceitas quando vêm do backoffice. Só o backoffice recebe
credenciais. As rotas de entrada e de desafio têm limite de tentativas por IP e por conta.

**Why this priority**: protege contra falsificação de requisição e adivinhação de senha; marcado como produção no
backlog, mas o front já trata o 429.

**Independent Test**: mandar uma escrita administrativa com outra origem e conferir 403; estourar o limite de
tentativas e conferir 429 com o tempo de espera.

**Acceptance Scenarios**:

1. **Given** uma escrita administrativa vinda de outra origem, **When** ela chega, **Then** é recusada com 403.
2. **Given** o portal público, **When** ele chama a API, **Then** não recebe credenciais nem cookie.
3. **Given** muitas tentativas de entrada do mesmo IP ou para a mesma conta, **When** o limite é passado, **Then** a
   resposta é 429 com o tempo de espera, e na etapa da senha o front mostra a mesma mensagem genérica.

---

### Edge Cases

- Sessão pendente que expira (passou o tempo do segundo fator) antes do desafio: 401, e a pessoa recomeça.
- Desafio sem sessão pendente, ou com sessão já verificada: 401.
- Corpo do desafio com `code` e `recoveryCode` ao mesmo tempo, ou nenhum dos dois: 400.
- Código de recuperação com letras minúsculas ou espaços: normalizado antes de conferir.
- Conta bloqueada pelo Administrador no meio do primeiro acesso: a etapa seguinte dá 401.
- Reset do MFA pelo Administrador (feature 005): na próxima entrada, a etapa é `MFA_ENROLLMENT_REQUIRED`.
- Pedir o cadastro do autenticador duas vezes: o segundo pedido substitui o primeiro ainda não confirmado.
- Trocar a senha pela mesma senha atual: 422 com o código `PASSWORD_SAME_AS_CURRENT` (código novo, fora da lista do
  contrato do front; o front trata como erro de política genérico).
- Bloqueio temporário que vence: a próxima tentativa correta entra normalmente.
- Relógio do autenticador adiantado ou atrasado mais de 30 s: código recusado.
- Senha, código e segredo nunca aparecem em log, trilha, mensagem de erro ou URL (inclusive trechos curtos).

## Requirements _(mandatory)_

### Functional Requirements

**Entrada com senha (AUTH-01)**

- **FR-001**: A pessoa DEVE poder entrar com e-mail e senha; com a senha correta, a resposta traz a próxima etapa em
  código (`MFA_REQUIRED`, `MFA_ENROLLMENT_REQUIRED`, `PASSWORD_CHANGE_REQUIRED` ou `DONE`), os horários de expiração da
  sessão (inatividade e absoluta, ISO 8601 UTC) e um cookie de sessão que ainda não abre as rotas administrativas.
- **FR-002**: E-mail inexistente, senha errada, conta bloqueada, desativada ou em bloqueio temporário DEVEM receber a
  mesma resposta 401 genérica, em tempo equivalente (diferença menor que 10% da verificação de senha); o motivo real
  (credencial, bloqueio temporário, bloqueada, desativada) fica só na trilha.
- **FR-003**: 5 falhas seguidas de senha numa conta DEVEM colocá-la em bloqueio temporário de 15 min; cada nova série
  de 5 falhas dobra o tempo; uma entrada completa zera o contador e a série. Falhas no desafio do segundo fator
  contam para o mesmo contador.
- **FR-004**: Um hash de senha com custo menor que o atual DEVE ser refeito com o custo atual na entrada bem-sucedida.

**Desafio do segundo fator (AUTH-04)**

- **FR-005**: Com a sessão pendente, a pessoa DEVE poder informar o código do autenticador (passo atual ou um passo de
  tolerância, ±30 s) ou um código de recuperação; com sucesso, a resposta traz a etapa seguinte (`DONE`, ou
  `PASSWORD_CHANGE_REQUIRED` se a troca for obrigatória, Q2), os horários de expiração e um cookie novo.
- **FR-006**: O mesmo código do autenticador NÃO PODE ser aceito duas vezes, e um código de recuperação só vale uma
  vez.
- **FR-007**: Código inválido (errado ou já usado) no desafio DEVE responder 422 `MFA_CODE_INVALID`, mantendo a
  sessão pendente; o bloqueio do desafio (5 falhas em 15 min) DEVE responder 423; em todo o fluxo, 401 significa só
  sessão ausente ou expirada (Q1).

**Primeiro acesso e cadastro do autenticador (AUTH-03, USERS-02)**

- **FR-008**: Quem tem a troca de senha obrigatória ou não tem autenticador NÃO PODE usar nenhuma rota administrativa
  além das da etapa em que está (troca de senha, cadastro do autenticador) e da saída. Com sessão verificada e troca
  obrigatória pendente, as demais rotas DEVEM responder 403 `PASSWORD_CHANGE_REQUIRED`; o `GET /me` continua liberado
  (R11 = A). Rota de etapa chamada fora da etapa DEVE responder 403 `STEP_NOT_ALLOWED` (I1).
- **FR-008a**: Os números do bloqueio temporário e do limite de tentativas DEVEM ser configuráveis no servidor, com os
  padrões aprovados (5 falhas, 15 min, até 24 h; 20/min por IP; 10 a cada 15 min por conta) e validação na subida.
- **FR-009**: O pedido de cadastro DEVE devolver a URI de configuração, o QR code como imagem PNG embutida (gerada no
  servidor, sem serviço externo) e o segredo em texto, com o nome do sistema como emissor; o segredo é guardado
  selado e nunca vai para log ou trilha.
- **FR-010**: O autenticador só passa a valer depois da confirmação com um código válido; a confirmação devolve 10
  códigos de recuperação uma única vez (guardados só como hash), a próxima etapa, os horários e um cookie novo. Código
  errado na confirmação DEVE responder 422 `MFA_CODE_INVALID`, com o cadastro ainda pendente (Q1).
- **FR-011**: A ordem das etapas DEVE ser: sem autenticador, troca de senha (se obrigatória) e depois cadastro do
  autenticador; com autenticador, segundo fator e depois troca de senha (se obrigatória). Ninguém troca a senha tendo
  provado só a senha antiga quando já tem autenticador (Q2).

**Troca de senha (AUTH-05)**

- **FR-012**: A pessoa DEVE poder trocar a própria senha informando a atual e a nova; a nova segue a política (mínimo
  de 12 caracteres, recusa de senhas comuns, diferente da atual).
- **FR-013**: Senha nova fora da política DEVE responder 422 com o código da regra (`PASSWORD_TOO_SHORT`,
  `PASSWORD_COMMON`, `PASSWORD_SAME_AS_CURRENT`); senha atual errada DEVE responder
  422 `CURRENT_PASSWORD_INVALID`; nenhuma resposta, log ou registro repete a senha.
- **FR-014**: Do 1º ao 4º erro de senha atual na mesma sessão a resposta é 422; o 5º DEVE responder 429 e encerrar a
  sessão. Erro de política não conta. Requisições simultâneas não passam do limite. Uma sessão nova começa do zero.
- **FR-015**: A troca bem-sucedida DEVE encerrar as outras sessões da pessoa, trocar o id da sessão atual, marcar a
  senha como trocada (fim da troca obrigatória) e responder com a próxima etapa e os horários.

**Sessões e saída (AUTH-02, AUTH-06)**

- **FR-016**: A pessoa DEVE poder sair (204, cookie apagado), listar as próprias sessões (criação, último uso, IP,
  navegador, marca da atual, sem o identificador secreto), encerrar uma sessão própria e encerrar todas.
- **FR-017**: Encerrar sessão de outra pessoa DEVE responder 404.
- **FR-018**: Cookie só `HttpOnly`, `Secure`, `SameSite=Strict`; nenhum token no corpo ou na URL; nenhum refresh token
  (D53).

**Proteções do navegador e limite (AUTH-07, AUTH-08)**

- **FR-019**: Escritas administrativas DEVEM ser aceitas só da origem do backoffice (outra origem: 403); só a origem do
  backoffice recebe credenciais; o portal público nunca.
- **FR-020**: Entrada e desafio DEVEM ter limite de tentativas por IP e por conta, com 429 e o tempo de espera; o
  limite vale para todas as instâncias da API.

**Auditoria**

- **FR-021**: DEVEM ser registrados: entrada concluída, falha de entrada (com motivo codificado), falha e bloqueio do
  desafio, uso de código de recuperação, cadastro do autenticador, troca de senha, falha de troca (motivo, tentativa,
  bloqueio), saída e encerramento de sessões; sempre sem senha, código, segredo ou identificador de sessão.

### Privacy & Security _(mandatory)_

- **Personal or sensitive data handled**: e-mail e senha da equipe (só em trânsito; a senha só como hash), segredo do
  autenticador (selado com a `app-kek`, nunca devolvido depois do cadastro), códigos de recuperação (devolvidos uma
  vez, guardados como hash), IP e navegador das sessões da equipe (área administrativa, para a pessoa reconhecer as
  próprias sessões). Nenhum dado de denunciante ou de denúncia.
- **Anonymity impact**: nenhuma rota pública é tocada; o portal público continua sem cookie e sem credenciais
  (FR-019). Nenhuma senha, código ou e-mail vai na URL.
- **Encryption**: segredo do autenticador selado pelo Vault (`app-kek`, já no store da feature 004); senhas com hash
  scrypt (D32); códigos de recuperação com hash; nenhuma chamada ao Vault dentro de transação.
- **Access**: rotas de entrada e de desafio abertas antes da sessão completa; rotas de primeiro acesso só na etapa
  correspondente; o resto da área administrativa só com sessão verificada; cada pessoa só vê e encerra as próprias
  sessões.
- **Audit events**: `AUTH_SIGNED_IN`, `AUTH_LOGIN_FAILED` (motivo codificado), `AUTH_MFA_FAILED`,
  `AUTH_RECOVERY_CODE_USED`, `AUTH_MFA_ENROLLED`, `AUTH_PASSWORD_CHANGED`, `AUTH_PASSWORD_CHANGE_FAILED` (motivo,
  tentativa, bloqueio), `AUTH_SIGNED_OUT`, `AUTH_SESSION_REVOKED`; ator pelo contexto (D46, D47), horário exato (D25);
  nunca senha, código, segredo, e-mail ou identificador de sessão na metadata.
- **Retention**: dados da equipe não são cripto-fragmentados com as denúncias; sessões expiram e são apagadas;
  registros da trilha seguem a guarda da trilha (D49).

### Key Entities

- **Pessoa da equipe**: já existe (feature 005); aqui usam-se o contador de falhas, o fim do bloqueio temporário, a
  série de bloqueios, a data da troca de senha e o último login.
- **Sessão**: já existe (feature 004); ganha o contador de erros de senha atual da própria sessão e expõe à pessoa
  criação, último uso, IP e navegador.
- **Autenticador e códigos de recuperação**: já existem (feature 004); aqui o cadastro, a confirmação e o uso pelas
  rotas reais.
- **Próxima etapa**: código calculado a cada resposta a partir da sessão e da pessoa (não é guardado).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Uma pessoa com autenticador entra (senha e código) em menos de 30 segundos; uma recém-cadastrada conclui
  o primeiro acesso (troca, cadastro, confirmação) em menos de 3 minutos.
- **SC-002**: A diferença de tempo entre "e-mail inexistente" e "senha errada" fica abaixo de 10% da duração da
  verificação de senha, medida sobre ao menos 20 tentativas de cada.
- **SC-003**: Em 100% dos casos de erro de entrada (inexistente, senha errada, bloqueada, desativada, bloqueio
  temporário) a resposta é idêntica; nenhum caso revela se o e-mail existe.
- **SC-004**: Nenhuma rota administrativa além das da etapa abre antes da sessão verificada, em 100% das rotas
  existentes (verificado por teste que percorre as rotas).
- **SC-005**: Senha, código, segredo e códigos de recuperação nunca aparecem em log, trilha ou mensagem de erro
  (verificado com textos longos e curtos).
- **SC-006**: As respostas das rotas de entrada, desafio, cadastro e troca de senha batem com o contrato do front
  (mesmas chaves e tipos), verificado automaticamente.
- **SC-007**: O teste do fluxo inteiro (entrada, desafio, rota protegida, saída, rota protegida com 401) passa sem o
  login de exemplo da feature 004.

## Assumptions

- O formato das respostas segue o contrato do front (`StepResponse`, `nextStep`, `idleExpiresAt`,
  `absoluteExpiresAt`, `qrCodeDataUri`, `recoveryCodes`), salvo o que as Questões 1 e 2 decidirem.
- O corpo do desafio aceita `{ code }` ou `{ recoveryCode }`, como no contrato do front.
- O cookie se chama `__Host-sid` e é sempre `Secure`; em desenvolvimento, o backoffice roda em `localhost` (contexto
  seguro do navegador). O nome do cookie não faz parte do contrato do front, que nunca o lê.
- O limite de tentativas usa o armazenamento compartilhado que a API já tem (Redis) para valer entre instâncias.
- "Encerrar todas as sessões" inclui a atual (a pessoa sai).
- A lista de sessões e o encerramento de uma sessão ainda não têm tela no backoffice; o contrato segue o backlog.
- O login de exemplo de `test/contract/auth/example/` pode ser mantido para os testes de contrato da feature 004, mas
  as features seguintes passam a usar as rotas definitivas.
