# Feature Specification: Decisão das bibliotecas de autenticação e autorização

**Feature Branch**: `main` (nenhuma branch criada: não há hook `before_specify` registrado)

**Created**: 2026-11-28

**Status**: Draft

**Input**: User description: "Etapa 3 da ordem de implementação do backlog ('Decisões de auth'): AUTH-00
(`docs/tarefas/04-auth.md`) e ACL-00 (`docs/tarefas/05-access-control.md`). Os critérios de aceite e as decisões D03,
D10, D20, D21, D32 e D47 de `docs/adr/README.md` valem como requisitos. A feature decide e prova, não implementa os
módulos: escolher entre passport/CASL e os pacotes oficiais do Nest 12 (`@nestjs/authentication` e
`@nestjs/authorization`), registrar no ADR e provar com um protótipo mínimo, com testes, que a opção escolhida atende
aos requisitos do projeto, para que as features de equipe, login e controle de acesso implementem sobre ela."

## Escopo

Esta feature é uma **decisão técnica com prova**. Ela não entrega login, cadastro da equipe nem permissões para uso
real: entrega a escolha das bibliotecas que vão sustentar esses módulos, os motivos, o impacto nas decisões já
tomadas e um protótipo mínimo, testado, que mostra que a escolha cumpre os requisitos de segurança do projeto antes de
qualquer código definitivo ser escrito sobre ela.

**Tarefas do backlog cobertas**: AUTH-00 e ACL-00.

**Por que agora**: a ordem do backlog põe estas decisões antes de qualquer código de login ou permissão (etapa 3),
porque trocar de biblioteca depois exigiria reescrever usuários, sessão, MFA e todas as políticas de acesso.

**O que já existe e condiciona a decisão (não é reespecificado)**:

- **Hash de senha (D32, feature 001)**: a senha da equipe já é guardada com o componente de hash do pacote oficial de
  autenticação, na versão fixada 0.1.8, usado isoladamente (sem o módulo completo). Isso alterou a D03 (de argon2id
  para scrypt) e adiantou parte do AUTH-00.
- **Área administrativa fechada (D47, feature 003)**: toda rota administrativa responde 401 enquanto não houver uma
  identidade. A identidade vem de um ponto de extensão que hoje devolve "ninguém"; a feature de login vai trocar essa
  implementação. Nos testes existe uma identidade simulada.
- **Ator da auditoria pelo contexto (D46, feature 003)**: a trilha descobre quem fez a ação pela área da rota; para a
  equipe, usa a identidade fornecida por esse mesmo ponto de extensão.
- **Matriz de permissões (ACL-01, D20, D21)**: 5 perfis (Administrador, Gestor de compliance, Analista, DPO, Auditor);
  o DPO lê todas as denúncias sem tratar; o Administrador pode acumular perfis, mas ninguém altera os próprios perfis;
  o conflito de interesse bloqueia o acesso em qualquer perfil.
- **Modelo de dados (feature 001)**: as tabelas de sessões e de códigos de recuperação já existem e podem ser usadas ou
  ajustadas por migration.

**Fora do escopo**: implementar os módulos de usuários (03-users), login (04-auth, AUTH-01 em diante) e controle de
acesso (05-access-control, ACL-01 em diante); telas do backoffice; limite de tentativas de login (AUTH-08).

## Clarifications

### Session 2026-11-28

- Q: O protótipo é descartável ou a base reaproveitada pelas features de login e controle de acesso? → A: Híbrido
  (opção C). O store de sessões no Postgres e a ligação com a porta `AUTH_IDENTITY` são definitivos; login, MFA e
  políticas de exemplo ficam como teste de contrato (FR-023).
- Q: Aceitar os pacotes oficiais (0.1.x) para toda a autenticação e autorização? → A: Sim (Q-P1 = A), com versão
  exata, suíte de contrato contra os stores Postgres e saída pela porta `AUTH_IDENTITY`.
- Q: Manter a renovação (refresh tokens) com detecção de reuso por família? → A: Não (Q-P2 revista para a opção A).
  Primeiro o usuário escolheu manter (B); ao ver o desenho, a renovação virou um canal separado para clientes que não
  são navegador, que hoje ninguém usa, e ele preferiu não ter a superfície extra. Fica só a sessão por cookie no
  servidor: 15 min sem uso, 8 h no máximo, id trocado no login e no MFA, e encerramento de todas as sessões do usuário
  (FR-010). Um canal de tokens pode ser criado no futuro, por decisão própria, se surgir um cliente que não seja
  navegador.

## User Scenarios & Testing _(mandatory)_

Os "usuários" desta feature são a equipe de desenvolvimento, que vai construir os módulos seguintes sobre a decisão,
e quem revisa a segurança do projeto (compliance e DPO), que precisa entender por que a escolha é segura.

### User Story 1 - Decisão registrada com critérios verificáveis (Priority: P1)

Quem vai implementar o login e as permissões abre o registro de decisões e encontra, para autenticação e para
autorização, a opção escolhida, as alternativas avaliadas, a tabela de requisitos com o resultado de cada opção
(atende, atende com extensão própria, não atende), os riscos aceitos e o impacto nas decisões anteriores.

**Why this priority**: sem a decisão registrada, as três features seguintes não podem começar, e a escolha poderia ser
refeita sem histórico.

**Independent Test**: ler o registro de decisões e conferir que cada requisito obrigatório desta spec aparece com o
resultado de cada opção e com a evidência (teste do protótipo ou documentação) que o sustenta.

**Acceptance Scenarios**:

1. **Given** o registro de decisões, **When** alguém procura a decisão de autenticação, **Then** encontra a opção
   escolhida, as alternativas, os motivos e o efeito na D03 e no modelo de dados (tabelas de sessões e de códigos de
   recuperação).
2. **Given** o registro de decisões, **When** alguém procura a decisão de autorização, **Then** encontra a opção
   escolhida, coerente com a de autenticação, e como o filtro de listagem por permissão será feito.
3. **Given** um requisito obrigatório que a opção escolhida não atende sozinha, **When** se lê a decisão, **Then** ela
   diz qual extensão própria cobre a lacuna e qual teste do protótipo prova essa extensão.
4. **Given** a maturidade do pacote escolhido, **When** se lê a decisão, **Then** os riscos (versão, mudanças de API,
   manutenção) estão registrados com a mitigação (versão fixada, testes de contrato, ponto de saída).

---

### User Story 2 - Login com MFA e sessão segura provados no protótipo (Priority: P1)

Um membro da equipe, no protótipo, entra com e-mail e senha, recebe o desafio do segundo fator, informa o código do
aplicativo autenticador e só então acessa uma rota protegida. A sessão vive num cookie que o JavaScript da página não
lê, expira depois de 15 minutos sem uso ou 8 horas no máximo, e fica guardada no banco, não na memória do processo.

**Why this priority**: é o requisito mais sensível do login (D03) e o que mais pesa na escolha: se a opção não
sustentar MFA, cookie seguro, expirações e armazenamento no banco, ela é descartada.

**Independent Test**: rodar os testes do protótipo contra o Postgres e ver cada cenário abaixo passar, inclusive
reiniciando a aplicação entre o login e o acesso para provar que a sessão não vive em memória.

**Acceptance Scenarios**:

1. **Given** um usuário com senha e segundo fator cadastrados, **When** entra só com a senha, **Then** a rota
   protegida continua respondendo 401 até o código do segundo fator ser aceito.
2. **Given** um e-mail inexistente e um e-mail existente com senha errada, **When** se tenta entrar, **Then** as duas
   respostas são iguais e levam tempo equivalente (não revelam quais e-mails existem).
3. **Given** uma sessão válida, **When** passam 15 minutos sem uso, **Then** a próxima requisição responde 401.
4. **Given** uma sessão usada continuamente, **When** completam 8 horas desde o login, **Then** a próxima requisição
   responde 401, mesmo com uso recente.
5. **Given** uma sessão criada, **When** a aplicação é reiniciada, **Then** a sessão continua válida, porque está
   guardada no banco; e com o ambiente em modo produção a aplicação se recusa a subir se o armazenamento for em
   memória.
6. **Given** a resposta de login, **When** se inspeciona o cookie, **Then** ele não é legível por JavaScript, só
   trafega em conexão segura e não é enviado em requisições vindas de outros sites.
7. **Given** um usuário com várias sessões abertas, **When** todas as sessões dele são encerradas (saída de todos os
   lugares, troca de senha ou desativação), **Then** nenhuma delas autentica a requisição seguinte; e o id da sessão
   muda no login e na verificação do segundo fator (proteção contra fixação de sessão).
8. **Given** um código de segundo fator já usado, **When** é enviado de novo dentro da mesma janela, **Then** é
   recusado.

---

### User Story 3 - Permissões negadas por padrão e filtro no banco provados no protótipo (Priority: P1)

No protótipo, uma rota sem regra de permissão declarada é negada para qualquer pessoa logada; uma rota com regra
deixa passar só o perfil certo; e uma listagem devolve apenas os registros que a pessoa pode ver, filtrados na
própria consulta ao banco, nunca carregando tudo para filtrar depois.

**Why this priority**: "negado por padrão" e "escopo no WHERE" são o princípio IV da constituição. A autorização
escolhida precisa sustentar os dois, ou o controle de acesso viraria código espalhado.

**Independent Test**: rodar os testes do protótipo com usuários de perfis diferentes e conferir as respostas e a
consulta gerada para a listagem.

**Acceptance Scenarios**:

1. **Given** uma rota administrativa sem regra de permissão declarada, **When** uma pessoa logada a chama, **Then** a
   resposta é 403, e a inicialização lista essa rota como desprotegida.
2. **Given** uma rota com regra "só Gestor de compliance", **When** um Analista a chama, **Then** a resposta é 403; e
   **When** um Gestor a chama, **Then** a resposta é 200.
3. **Given** registros atribuídos a analistas diferentes e um bloqueio por conflito de interesse, **When** um Analista
   lista, **Then** recebe só os atribuídos a ele e sem o bloqueado, e a consulta ao banco já contém essas condições.
4. **Given** um DPO, **When** lista e abre um registro, **Then** consegue ler, mas uma ação de tratar responde 403
   (D20).
5. **Given** um Administrador, **When** tenta alterar os próprios perfis, **Then** a resposta é 403 (D21).
6. **Given** uma requisição negada, **When** se consulta a trilha de auditoria, **Then** existe um registro de acesso
   negado com o ator, o recurso e o resultado, sem conteúdo de denúncia.
7. **Given** uma requisição sem sessão, **When** chega a uma rota administrativa, **Then** a resposta é 401 (não 403):
   falta de identidade e falta de permissão continuam distinguíveis.

---

### User Story 4 - Encaixe com o que já existe (Priority: P2)

O protótipo usa a opção escolhida junto com o que as features anteriores entregaram: o hash de senha atual continua
válido (senhas já gravadas pelo comando de criar administrador entram normalmente), o ponto de extensão de identidade
da área administrativa passa a ser alimentado pela sessão real, e a trilha de auditoria registra a equipe com a
identidade da sessão.

**Why this priority**: a decisão não pode exigir refazer as features 001 e 003; mas o encaixe é verificável depois da
prova principal (US2 e US3).

**Independent Test**: no protótipo, criar o administrador pelo comando existente, entrar com ele e conferir que a
auditoria grava a ação com a identidade da sessão.

**Acceptance Scenarios**:

1. **Given** um administrador criado pelo comando existente, **When** entra no protótipo, **Then** a senha é aceita sem
   migração de hash.
2. **Given** uma sessão válida, **When** uma rota administrativa auditada é chamada, **Then** a trilha registra o ator
   equipe com o id da sessão, e a regra de que o código não informa o ator por conta própria continua valendo.
3. **Given** a escolha de autorização, **When** comparada à matriz do ACL-01, **Then** cada linha da matriz tem um jeito
   previsto de ser expressa (regra por rota, checagem no serviço ou filtro na consulta).

---

### Edge Cases

- A opção preferida não atende a um requisito obrigatório (por exemplo, expiração por inatividade): a decisão precisa
  registrar a extensão própria que cobre a lacuna, provada por teste, ou trocar de opção.
- O pacote oficial muda de API entre versões menores (0.1.x): a versão fica fixada e os testes do protótipo funcionam
  como testes de contrato.
- Dois requisitos conflitam (por exemplo, sessão por cookie e a necessidade de uma ferramenta de linha de comando
  agir como sistema): o protótipo mostra que a área administrativa usa sessão e que jobs e comandos seguem como
  sistema, sem identidade de equipe.
- O armazenamento no banco falha durante o login: o login não é concluído e nada fica em memória como fallback.
- Relógio do servidor ajustado durante uma sessão: as expirações usam o horário do servidor de banco ou do processo de
  forma consistente, sem renovar a sessão por engano.
- Usuário desativado com sessão aberta: a próxima requisição responde 401 (a identidade é recarregada a cada
  requisição, não lida de um token antigo).

## Requirements _(mandatory)_

### Functional Requirements

**Decisão (AUTH-00, ACL-00)**

- **FR-001**: O registro de decisões DEVE ganhar uma decisão de autenticação e uma de autorização, cada uma com: opção
  escolhida, alternativas avaliadas (bibliotecas de terceiros previstas originalmente e pacotes oficiais do Nest 12),
  motivos, riscos aceitos e mitigação.
- **FR-002**: Cada decisão DEVE trazer uma tabela com todos os requisitos obrigatórios desta spec (FR-005 a FR-021) e o
  resultado de cada opção avaliada: atende, atende com extensão própria ou não atende, com a evidência.
- **FR-003**: A decisão de autenticação DEVE registrar o impacto na D03 e na D32 (hash de senha) e no modelo de dados
  das tabelas de sessões e de códigos de recuperação, inclusive se exige migration.
- **FR-004**: A decisão de autorização DEVE ser coerente com a de autenticação e DEVE dizer como o filtro de listagem
  por permissão será construído na consulta ao banco.

**Requisitos que a escolha precisa provar no protótipo (autenticação)**

- **FR-005**: O login DEVE exigir senha e segundo fator por código de aplicativo autenticador; com só a senha, nenhuma
  rota protegida é liberada.
- **FR-006**: E-mail inexistente e senha errada DEVEM produzir a mesma resposta em tempo equivalente.
- **FR-007**: A sessão DEVE viver num cookie não legível por JavaScript, enviado só em conexão segura e não enviado em
  requisições de outros sites; o token de sessão não aparece no corpo das respostas nem em URL.
- **FR-008**: A sessão DEVE expirar após 15 minutos sem uso e após 8 horas desde o login, o que vier primeiro.
- **FR-009**: Sessões e estado do segundo fator DEVEM ficar no Postgres; em modo produção, a aplicação DEVE
  se recusar a subir com armazenamento em memória.
- **FR-010**: O id da sessão DEVE ser trocado no login, na verificação do segundo fator e na troca de senha; encerrar
  todas as sessões de um usuário (saída de todos os lugares, troca de senha, desativação) DEVE fazer com que nenhuma
  delas autentique a requisição seguinte. Não há tokens de renovação nem tokens portadores (Q-P2 revista).
- **FR-011**: Um código de segundo fator DEVE ser aceito uma única vez dentro da sua janela de validade.
- **FR-012**: A identidade DEVE ser recarregada do banco a cada requisição; usuário desativado ou com perfil alterado
  tem o efeito na requisição seguinte.
- **FR-013**: O protótipo DEVE aceitar as senhas já gravadas com o hash atual (D32), sem migração.
- **FR-014**: A sessão real DEVE alimentar o ponto de extensão de identidade da área administrativa (D47), mantendo
  401 para quem não tem sessão.
- **FR-015**: Login, saída, falha do segundo fator e encerramento de sessões DEVEM ser auditáveis pelo catálogo da trilha
  (feature 003), sem senha, código ou token na metadata.

**Requisitos que a escolha precisa provar no protótipo (autorização)**

- **FR-016**: Rota administrativa sem regra de permissão declarada DEVE responder 403 para quem está logado, e a
  inicialização DEVE listar as rotas nessa situação.
- **FR-017**: As regras DEVEM distinguir os 5 perfis e permitir regras que dependem do registro (atribuição, conflito
  de interesse), com acesso a serviços da aplicação.
- **FR-018**: Listagens DEVEM ser filtradas na consulta ao banco pelas mesmas regras de permissão (atribuição e
  conflito de interesse), sem carregar registros que a pessoa não pode ver.
- **FR-019**: O DPO DEVE conseguir ler e NÃO DEVE conseguir tratar (D20); ninguém DEVE conseguir alterar os próprios
  perfis (D21).
- **FR-020**: Toda negação (403) DEVE gerar um registro de acesso negado na trilha, com ator, recurso e resultado, sem
  conteúdo de denúncia.
- **FR-021**: Falta de sessão (401) e falta de permissão (403) DEVEM continuar distinguíveis.

**Protótipo**

- **FR-022**: O protótipo DEVE rodar contra o Postgres do ambiente de desenvolvimento e do CI, com testes automatizados
  para cada cenário das US2, US3 e US4.
- **FR-023**: O protótipo é híbrido (Q1 = C). **Definitivo** (fica no código, com testes, e as features seguintes
  constroem sobre ele): o armazenamento de sessões e do estado do segundo fator no Postgres, incluindo a
  migration que ajustar as tabelas de sessões e de códigos de recuperação, e a ligação da sessão real com o ponto de
  extensão de identidade da área administrativa (D47). **Teste de contrato** (código só de teste, fora de `src/`, que
  prova o comportamento dos pacotes e é reexecutado a cada atualização de versão): o fluxo de login com senha e segundo
  fator, as rotas protegidas de exemplo e as políticas de permissão de exemplo (perfis, atribuição, conflito de
  interesse, DPO, autoalteração de perfis, filtro de listagem). As rotas de login reais, as políticas reais e a matriz
  completa ficam para as features 04-auth e 05-access-control.
- **FR-024**: A versão dos pacotes escolhidos DEVE ficar fixada (sem faixa de versão), e os testes do protótipo DEVEM
  servir como testes de contrato em futuras atualizações.

### Privacy & Security _(mandatory)_

- **Personal or sensitive data handled**: e-mail e hash de senha da equipe interna, segredo do segundo fator (já
  cifrado com a chave da aplicação, feature 002), sessões (guardadas só como hash ou identificador
  opaco). Nenhum dado de denunciante e nenhum conteúdo de denúncia. No protótipo, só usuários fictícios.
- **Anonymity impact**: nenhuma rota pública é tocada. A área pública continua sem sessão, sem cookie e sem IP (D39,
  princípio I). O protótipo prova que a escolha não exige cookie nem identificação na área pública.
- **Encryption**: o segredo do segundo fator continua cifrado com a chave da aplicação (`app-kek`), preso ao usuário
  (feature 002). Tokens de sessão ficam guardados só como hash.
- **Access**: a decisão é justamente sobre como os 5 perfis, a atribuição e o conflito de interesse serão aplicados;
  o protótipo prova negação por padrão e escopo na consulta (princípio IV).
- **Audit events**: login, saída, falha de segundo fator, encerramento de sessão e acesso negado passam a ter ações no
  catálogo da trilha (ou têm sua inclusão prevista), sem senha, código, token ou conteúdo de denúncia na metadata.
- **Retention**: sessões expiradas ou revogadas seguem a limpeza já prevista no backlog de retenção
  (RET-05); não entram no crypto-shredding de denúncias.

### Key Entities

- **Decisão de autenticação**: escolha, alternativas, tabela de requisitos × opções, riscos, impacto em D03/D32 e no
  modelo de dados.
- **Decisão de autorização**: escolha, coerência com a autenticação, forma do filtro de listagem, mapeamento da matriz
  do ACL-01.
- **Sessão**: pertence a um membro da equipe; tem momento de criação, último uso, expiração absoluta, e estado do segundo
  fator.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% dos requisitos obrigatórios (FR-005 a FR-021) aparecem na tabela de cada decisão com resultado e
  evidência.
- **SC-002**: 100% dos cenários das US2, US3 e US4 têm teste automatizado passando contra o Postgres, localmente e no
  CI.
- **SC-003**: Depois de 15 minutos sem uso, ou de 8 horas desde o login, 100% das tentativas de acesso com a sessão
  antiga são recusadas.
- **SC-004**: Com a aplicação reiniciada, 100% das sessões válidas continuam válidas; em modo produção com
  armazenamento em memória, a aplicação não sobe.
- **SC-005**: Em 100% dos casos em que todas as sessões de um usuário são encerradas, nenhuma delas autentica a
  requisição seguinte; e 100% dos logins e verificações de segundo fator trocam o id da sessão.
- **SC-006**: A diferença de tempo entre "e-mail inexistente" e "senha errada" fica abaixo de 10% da duração da
  verificação de senha, medida sobre ao menos 20 tentativas de cada.
- **SC-007**: Uma pessoa da equipe que não participou da decisão consegue, só lendo o registro de decisões, dizer qual
  biblioteca usar e como expressar cada linha da matriz de permissões.

## Assumptions

- **Critério de escolha**: entre as opções que atendem a todos os requisitos obrigatórios (sozinhas ou com extensão
  própria provada), prefere-se a que exige menos código próprio de segurança e menos dependências, seguindo o
  princípio VIII da constituição ("pacote oficial do Nest deve ser avaliado antes de biblioteca de terceiros"). A
  maturidade (0.1.x) entra como risco, já aceito para o hash pela D32.
- **Avaliação sem decisão prévia**: apesar de o hash já usar o pacote oficial, a avaliação de sessão, MFA e
  autorização é feita do zero para as duas opções; manter o hash do pacote oficial não obriga a usar o resto dele.
- **Ambiente**: o protótipo roda no mesmo Postgres de desenvolvimento e de CI das features anteriores; o tempo de 15
  minutos e 8 horas é testado com relógio controlado, não esperando o tempo real.
- **Cookie em desenvolvimento**: em HTTP local, o cookie pode perder o atributo de conexão segura só no ambiente de
  desenvolvimento; os testes conferem os atributos de produção.
- **Recuperação de acesso**: códigos de recuperação do segundo fator e troca de senha são avaliados só quanto à
  viabilidade na opção escolhida (registrada na tabela), sem cenário no protótipo.
- **Fora do protótipo**: telas, limite de tentativas (AUTH-08), CORS e CSRF da integração com o front (AUTH-07) são
  avaliados na tabela, mas implementados nas features seguintes.
