# Feature Specification: Infraestrutura transversal da API

**Feature Branch**: `main` (nenhuma branch criada: não há hook `before_specify` registrado)

**Created**: 2026-11-27

**Status**: Draft

**Input**: User description: "Conteúdo de `docs/tarefas/00-transversal.md` (tarefas TRV-01 a TRV-12). Os IDs de
tarefa, os critérios de aceite e as decisões registradas em `docs/tarefas/README.md` valem como requisitos."

## Escopo

Esta feature entrega a base que todos os módulos da API usam: formato de erro seguro, validação de entrada,
configuração validada na inicialização, acesso ao serviço de gerenciamento de chaves, fila de processamento em
segundo plano, convenções das rotas públicas e administrativas, paginação, base de testes e publicação do contrato
da API. É o primeiro passo da ordem de implementação do backlog.

**Tarefas do backlog cobertas**: todas as 12 (TRV-01 a TRV-12), decidido em 2026-11-27. Inclui TRV-06
(armazenamento de arquivos) e TRV-12 (referência de proxy), do marco Produção, e TRV-09 (primeiro administrador),
que depende de USERS-01 e AUTH-00. Para a TRV-09, esta feature entrega só o mínimo de cadastro e de hash de senha
necessário ao comando; o restante de users e auth fica nas features próprias.

## Clarifications

### Session 2026-11-27

- Q: Quais tarefas de `00-transversal.md` entram nesta feature? → A: Todas as 12 (TRV-01 a TRV-12). As user
  stories 10 a 12 fazem parte do escopo.
- Q: Criar branch de feature? → A: Não. O trabalho segue na `main`.
- Q (plano): algoritmo do hash de senha da equipe? → A: o do pacote oficial de autenticação do framework (scrypt),
  já nesta feature. Altera a decisão D03.
- Q (plano): como auditar a criação do primeiro administrador antes do módulo de auditoria? → A: o núcleo da
  gravação auditada com cadeia de hash entra nesta feature.
- Requisito do plano do front (2026-11-27): o contrato da API é exportado por comando local em dois arquivos
  versionados (público e administrativo), para gerar dois clientes separados (FR-038, FR-038a).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Erros que nunca vazam dados (Priority: P1)

Quem usa a API, seja o denunciante pelo portal ou a equipe pelo backoffice, recebe erros num formato único e
previsível. Nenhuma resposta de erro, nem o log correspondente, expõe trecho de relato, senha, detalhes internos
ou nomes de estruturas do banco.

**Why this priority**: todo módulo depende de um tratamento de erro seguro. Um erro que repete o texto de um relato
vaza exatamente o que o sistema existe para proteger.

**Independent Test**: provocar erros de cada tipo (entrada inválida, sem autenticação, sem permissão, recurso
inexistente, conflito e falha inesperada) e conferir o corpo da resposta e as linhas de log.

**Acceptance Scenarios**:

1. **Given** uma requisição qualquer, **When** ocorre um erro, **Then** a resposta traz código, tipo de erro,
   mensagem e um identificador da requisição igual ao do log.
2. **Given** uma falha inesperada cuja mensagem original contém texto de um relato, **When** a API responde,
   **Then** a resposta é um erro genérico sem esse texto, e os detalhes técnicos ficam só no log interno.
3. **Given** uma operação que violaria um registro único ou uma referência inexistente, **When** a API responde,
   **Then** o código é de conflito (ou de não encontrado) e a mensagem não cita a estrutura interna violada.
4. **Given** qualquer erro, **When** ele é registrado, **Then** o corpo da requisição não é copiado para o log nem
   para a resposta.

---

### User Story 2 - Entrada validada sem ecoar o que foi enviado (Priority: P1)

Toda entrada recebida pela API é validada antes de chegar à regra de negócio. Campos desconhecidos são recusados,
textos livres têm limite de tamanho e as mensagens de validação dizem o que está errado sem repetir o valor
recebido.

**Why this priority**: entrada sem validação é a porta de entrada de abuso e de dados inconsistentes. Repetir o
valor enviado numa mensagem de erro ecoaria relatos e senhas.

**Independent Test**: enviar a um recurso de exemplo um campo extra, um texto longo demais e um tipo errado, e
conferir a recusa e o conteúdo das mensagens.

**Acceptance Scenarios**:

1. **Given** uma requisição com um campo que o recurso não conhece, **When** ela chega, **Then** é recusada como
   entrada inválida, e não aceita ignorando o campo.
2. **Given** um texto livre acima do limite, **When** ele é enviado, **Then** a requisição é recusada e a mensagem
   indica o limite, sem repetir o texto.
3. **Given** um campo com tipo errado, **When** ele é enviado, **Then** a mensagem indica o campo e o tipo
   esperado, sem repetir o valor.

---

### User Story 3 - Configuração insegura impede a inicialização (Priority: P1)

Quem opera o sistema recebe uma falha imediata na inicialização se a configuração dos serviços externos estiver
ausente, incompleta ou insegura, em vez de descobrir o problema na primeira requisição.

**Why this priority**: uma configuração errada em produção, como uma credencial de administrador total no serviço
de chaves ou um segredo fraco, compromete toda a proteção dos dados.

**Independent Test**: iniciar a API com combinações de configuração válidas e inválidas e conferir se ela sobe ou
recusa com uma mensagem clara.

**Acceptance Scenarios**:

1. **Given** uma configuração sem o endereço de um serviço obrigatório (fila, chaves, e-mail, antivírus ou
   armazenamento), **When** a API inicia, **Then** ela não sobe e informa qual item falta.
2. **Given** um ambiente de produção configurado com a credencial de administrador total do serviço de chaves,
   **When** a API inicia, **Then** ela recusa a inicialização.
3. **Given** um ambiente de produção sem a credencial de aplicação do serviço de chaves, **When** a API inicia,
   **Then** ela recusa a inicialização.
4. **Given** um segredo de sessão ou de token do denunciante com menos de 32 bytes, **When** a API inicia,
   **Then** ela recusa a inicialização.

---

### User Story 4 - Acesso confiável ao serviço de chaves (Priority: P1)

Os módulos que cifram dados conseguem gerar, abrir e recifrar chaves de dados e cifrar valores pequenos por meio de
um único ponto de acesso ao serviço de gerenciamento de chaves. Quando o serviço está fora do ar ou bloqueado, a
API responde com indisponibilidade temporária, sem travar e sem expor nada.

**Why this priority**: os módulos de criptografia e de auditoria, que vêm logo a seguir, dependem disso. Sem esse
acesso, nenhum dado sensível pode ser gravado.

**Independent Test**: contra o serviço de chaves do ambiente de desenvolvimento, gerar uma chave de dados, abri-la,
cifrar e decifrar um valor, recifrar e simular o serviço indisponível.

**Acceptance Scenarios**:

1. **Given** o serviço de chaves disponível, **When** um módulo pede uma nova chave de dados, **Then** recebe a
   chave em claro, para uso em memória, e a versão protegida, para guardar.
2. **Given** uma chave de dados protegida, **When** um módulo pede para abri-la, **Then** recebe a chave em claro.
3. **Given** o serviço de chaves fora do ar ou bloqueado, **When** um módulo faz uma chamada, **Then** a chamada
   termina em até 2 segundos e o cliente da API recebe indisponibilidade temporária.
4. **Given** qualquer chamada ao serviço de chaves, **When** algo é registrado em log ou numa mensagem de erro,
   **Then** nenhum valor em claro nem chave aparece.
5. **Given** um ambiente de produção, **When** a credencial temporária de acesso está perto de expirar, **Then** ela
   é renovada antes de expirar, sem interromper as requisições.

---

### User Story 5 - Rotas públicas anônimas por construção (Priority: P1)

Toda rota usada pelo denunciante segue regras fixas que tornam impossível, por construção, carregar dado
identificável no endereço, guardar estado no navegador por cookie ou deixar resposta sensível em cache. Toda rota
da equipe segue a convenção administrativa.

**Why this priority**: o anonimato do denunciante é o princípio inegociável do sistema. Uma convenção verificada
automaticamente impede que uma rota nova quebre essa regra por descuido.

**Independent Test**: uma verificação automática percorre todas as rotas registradas e falha diante de qualquer
rota pública fora da regra.

**Acceptance Scenarios**:

1. **Given** todas as rotas registradas, **When** a verificação automática roda, **Then** ela falha se alguma rota
   pública tiver parâmetro no endereço capaz de carregar protocolo, chave ou dado pessoal. Só o identificador
   aleatório de anexo é permitido.
2. **Given** qualquer resposta de rota pública, **When** ela é enviada, **Then** não define cookie.
3. **Given** qualquer resposta de rota pública ou administrativa, **When** ela é enviada, **Then** instrui o
   navegador e intermediários a não guardá-la em cache.
4. **Given** uma rota da área pública e outra da área administrativa, **When** são registradas, **Then** ficam
   respectivamente sob o prefixo público e o administrativo da versão 1.

---

### User Story 6 - Listagens paginadas e estáveis (Priority: P2)

A equipe navega por listas longas (denúncias, usuários, trilha de auditoria) página a página, sem itens repetidos
ou perdidos quando novos registros entram durante a navegação.

**Why this priority**: as caixas de denúncias e a trilha de auditoria crescem sem limite. Sem paginação estável, as
telas ficam lentas e inconsistentes.

**Independent Test**: paginar uma lista de exemplo inserindo registros no meio da navegação e conferir que nenhum
item se repete ou some.

**Acceptance Scenarios**:

1. **Given** uma lista, **When** a equipe pede uma página, **Then** recebe no máximo 100 itens e um cursor para a
   página seguinte.
2. **Given** um pedido acima de 100 itens, **When** ele chega, **Then** é limitado ou recusado.
3. **Given** registros novos inseridos durante a navegação, **When** a página seguinte é pedida com o cursor,
   **Then** nenhum item já visto se repete e nenhum item anterior ao cursor some.

---

### User Story 7 - Tarefas em segundo plano seguras (Priority: P2)

Trabalhos assíncronos, como notificações e manutenção, rodam numa fila com novas tentativas, sem duplicar
execuções e sem carregar conteúdo de denúncia.

**Why this priority**: notificações e expurgo dependem da fila. Um job com conteúdo de denúncia vazaria esse
conteúdo para um sistema que não é cifrado.

**Independent Test**: enfileirar um job de exemplo duas vezes com a mesma identidade, provocar uma falha e conferir
as novas tentativas, a ausência de duplicata e o conteúdo do job.

**Acceptance Scenarios**:

1. **Given** um job que falha, **When** é processado, **Then** é tentado de novo com intervalos crescentes, até um
   limite.
2. **Given** dois pedidos para a mesma tarefa, **When** são enfileirados, **Then** a tarefa roda uma vez só.
3. **Given** qualquer job, **When** é enfileirado, **Then** carrega só identificadores, nunca conteúdo de denúncia.
4. **Given** várias instâncias da API, **When** chega a hora de um job agendado, **Then** só uma instância o executa.
5. **Given** jobs concluídos ou com falha, **When** o tempo passa, **Then** o histórico guardado é limitado.

---

### User Story 8 - Base de testes que prova as regras de privacidade (Priority: P2)

Quem desenvolve tem uma base de testes que sobe a API exatamente como em produção, cria dados de exemplo (inclusive
denúncias já cifradas), limpa o banco sem violar a auditoria imutável e captura os logs de uma requisição para
provar que nada vazou.

**Why this priority**: a constituição exige testes que falham quando uma regra de privacidade é quebrada. Sem essa
base, esses testes ficam caros e inconsistentes.

**Independent Test**: escrever um teste de exemplo que sobe a API, cria uma denúncia cifrada, faz uma requisição
pública e confere que o log capturado não contém o texto do relato.

**Acceptance Scenarios**:

1. **Given** um teste de integração, **When** ele sobe a API, **Then** ela usa os mesmos prefixos, validação e
   tratamento de erros de produção.
2. **Given** um teste, **When** precisa de dados, **Then** há geradores para usuário com perfis, categoria e
   denúncia já cifrada.
3. **Given** suítes de teste em sequência, **When** cada uma termina, **Then** os dados são descartados sem tentar
   alterar a trilha de auditoria.
4. **Given** um teste de "não vazou", **When** faz uma requisição, **Then** consegue inspecionar todas as linhas de
   log daquela requisição.
5. **Given** a suíte completa, **When** roda, **Then** o custo do cálculo de hash de senha é reduzido só no ambiente
   de teste.

---

### User Story 9 - Contrato da API publicado para o front (Priority: P2)

O time do front gera o cliente da API a partir de um contrato publicado, separado entre área pública e área
administrativa.

**Why this priority**: o front é proibido de escrever o cliente da API à mão. Sem o contrato publicado, ele fica
bloqueado.

**Independent Test**: gerar o contrato no pipeline e conferir as duas áreas e os formatos de entrada e saída.

**Acceptance Scenarios**:

1. **Given** a API fora de produção, **When** alguém acessa a documentação, **Then** vê as rotas separadas em área
   pública e administrativa, com os formatos de entrada e saída.
2. **Given** o repositório da API, **When** alguém roda o comando de exportação, **Then** são gravados dois arquivos
   de contrato em caminho fixo: um só com as rotas públicas e outro só com as administrativas.
3. **Given** o pipeline de integração contínua, **When** o contrato versionado está desatualizado em relação ao
   código, **Then** o pipeline falha. Quando está em dia, o contrato é publicado como artefato.
4. **Given** a API em produção, **When** alguém tenta acessar a documentação, **Then** ela não está disponível.

---

### User Story 10 - Armazenamento de arquivos (Priority: P3)

Os módulos que lidam com anexos gravam, leem, consultam e apagam arquivos num armazenamento de objetos, sem
carregar o arquivo inteiro em memória.

**Why this priority**: necessário só para anexos, que estão fora do MVP.

**Independent Test**: contra o armazenamento do ambiente de desenvolvimento, gravar, ler, consultar e apagar um
arquivo grande.

**Acceptance Scenarios**:

1. **Given** um arquivo grande, **When** é gravado ou lido, **Then** é transferido em fluxo contínuo.
2. **Given** um lote de arquivos, **When** um módulo pede para apagá-los, **Then** todos são apagados numa operação.
3. **Given** o ambiente de desenvolvimento, **When** a API inicia, **Then** o repositório de arquivos é criado se
   não existir. Em produção, não é.

---

### User Story 11 - Criação do primeiro administrador (Priority: P3)

Quem instala o sistema cria o primeiro administrador por um comando de terminal, sem colocar senha em nenhum arquivo
do repositório.

**Why this priority**: sem o primeiro administrador ninguém entra no backoffice. Depende, porém, do cadastro de
usuários e da decisão de autenticação.

**Independent Test**: rodar o comando no ambiente de desenvolvimento e no container de produção e conferir o usuário
criado e o registro de auditoria.

**Acceptance Scenarios**:

1. **Given** nenhum administrador ativo, **When** o comando roda com nome e e-mail, **Then** pede a senha sem
   exibi-la, aplica a política de senha da API e cria o administrador.
2. **Given** um administrador ativo, **When** o comando roda sem a opção de forçar, **Then** recusa.
3. **Given** a opção de forçar, **When** o comando cria outro administrador, **Then** a criação é auditada como ação
   do sistema.
4. **Given** o administrador criado, **When** os dados dele são consultados, **Then** ele não tem segundo fator
   cadastrado, estado que obriga o cadastro no primeiro login (exigência verificada em AUTH-03).

---

### User Story 12 - Referência de proxy que preserva o anonimato (Priority: P3)

Quem implanta o sistema tem uma configuração de referência do proxy reverso que não registra acesso nas rotas
públicas e remove o endereço de origem antes de a requisição chegar à API.

**Why this priority**: o anonimato também depende do que fica fora da API. É obrigatório antes da produção, mas não
bloqueia o MVP.

**Independent Test**: aplicar a configuração de referência num ambiente de teste, fazer requisições públicas e
administrativas e conferir os registros do proxy e os cabeçalhos que chegam à API.

**Acceptance Scenarios**:

1. **Given** uma requisição pública, **When** passa pelo proxy, **Then** não gera registro de acesso e chega à API
   sem o cabeçalho de endereço de origem.
2. **Given** uma requisição administrativa, **When** passa pelo proxy, **Then** pode gerar registro de acesso com
   endereço.
3. **Given** uma conexão, **When** é estabelecida, **Then** usa versão segura de transporte (1.2 ou superior,
   preferindo 1.3) e o navegador é instruído a usar sempre conexão segura.
4. **Given** um envio de anexo, **When** passa pelo proxy, **Then** o limite de tamanho de corpo comporta o
   tamanho máximo de anexo.

---

### Edge Cases

- Erro lançado por uma biblioteca com mensagem que contém dado do usuário: a resposta continua genérica e o log não
  copia o corpo da requisição.
- Violação de restrição do banco que não seja de unicidade nem de referência: tratada como falha inesperada (500
  genérico), sem nome de restrição.
- Serviço de chaves responde lentamente: a chamada é interrompida em 2 segundos e não segura conexões indefinidamente.
- Serviço de chaves volta ao ar: as chamadas seguintes funcionam sem reiniciar a API.
- Credencial temporária do serviço de chaves expira durante uma requisição: a requisição falha com indisponibilidade
  temporária e a credencial é renovada.
- Cursor de paginação adulterado ou de formato inválido: recusado como entrada inválida.
- Job reenfileirado depois de uma falha no meio da execução: a idempotência impede efeito duplicado.
- Requisição pública com o cabeçalho de endereço de origem preenchido: a API não registra esse valor em lugar
  nenhum.
- Corpo de requisição vazio ou malformado: recusado como entrada inválida, sem repetir o conteúdo.

## Requirements _(mandatory)_

### Functional Requirements

**Erros (TRV-01)**

- **FR-001**: O sistema DEVE responder todos os erros no formato único `{ statusCode, error, message, requestId }`,
  com `requestId` igual ao identificador da requisição no log.
- **FR-002**: O sistema DEVE responder falhas inesperadas com código 500 e mensagem genérica. Detalhes técnicos vão
  só para o log interno.
- **FR-003**: O sistema DEVE converter violação de unicidade em conflito (409) e violação de referência em conflito
  (409) ou não encontrado (404), sem expor o nome da restrição.
- **FR-004**: O sistema NÃO DEVE copiar o corpo da requisição para o log nem para a resposta de erro.

**Validação (TRV-02)**

- **FR-005**: O sistema DEVE validar toda entrada antes da regra de negócio, com uma única abordagem de validação
  registrada no registro de decisões.
- **FR-006**: O sistema DEVE recusar (400) requisições com campos desconhecidos.
- **FR-007**: O sistema DEVE aplicar limite de tamanho a todo campo de texto livre.
- **FR-008**: Mensagens de validação NÃO DEVEM repetir o valor recebido.

**Configuração (TRV-03)**

- **FR-009**: O sistema DEVE validar na inicialização a configuração da fila, do serviço de chaves, do
  armazenamento de arquivos, do e-mail, do antivírus e dos segredos de sessão e de token do denunciante.
- **FR-010**: O sistema DEVE aceitar autenticação por token no serviço de chaves só fora de produção. Em produção,
  DEVE exigir credencial de aplicação e recusar a credencial de administrador total.
- **FR-011**: O sistema DEVE recusar segredos de sessão e de token do denunciante com menos de 32 bytes.

**Serviço de chaves (TRV-04)**

- **FR-012**: O sistema DEVE oferecer aos outros módulos um único ponto de acesso ao serviço de chaves com as
  operações: gerar chave de dados, abrir chave de dados, cifrar, decifrar e recifrar.
- **FR-013**: O sistema DEVE renovar a credencial temporária do serviço de chaves antes de ela expirar.
- **FR-014**: Cada chamada ao serviço de chaves DEVE terminar em até 2 segundos. Serviço fora do ar ou bloqueado
  DEVE resultar em indisponibilidade temporária (503) para o cliente da API.
- **FR-015**: Valores em claro e chaves NÃO DEVEM aparecer em logs nem em mensagens de exceção.

**Fila (TRV-05)**

- **FR-016**: O sistema DEVE oferecer uma fila compartilhada com as filas `notifications` e `maintenance`.
- **FR-017**: Jobs DEVEM ter novas tentativas com intervalo crescente, histórico de concluídos e falhos limitado e
  identidade derivada da tarefa, para não duplicar.
- **FR-018**: Jobs DEVEM carregar só identificadores, nunca conteúdo de denúncia.
- **FR-019**: Jobs agendados DEVEM rodar em uma única instância por vez.

**Armazenamento de arquivos (TRV-06)**

- **FR-020**: O sistema DEVE gravar, ler, consultar, apagar e apagar em lote arquivos num armazenamento de objetos
  compatível com o padrão S3, em fluxo contínuo.
- **FR-021**: O sistema DEVE criar o repositório de arquivos na inicialização só em desenvolvimento.

**Rotas (TRV-07)**

- **FR-022**: Rotas do denunciante DEVEM ficar sob `/api/public/v1/` e rotas da equipe sob `/api/admin/v1/`,
  declaradas por convenções próprias de cada área.
- **FR-023**: Uma verificação automática DEVE falhar se alguma rota pública tiver parâmetro de caminho que não seja
  o identificador aleatório de anexo.
- **FR-024**: Rotas públicas NÃO DEVEM definir cookie. O token do denunciante viaja no cabeçalho de autorização.
- **FR-025**: Todas as respostas de rotas públicas e de rotas administrativas DEVEM proibir cache.

**Paginação (TRV-08)**

- **FR-026**: Listagens DEVEM ser paginadas por cursor, com no máximo 100 itens por página e resposta
  `{ items, nextCursor }`.
- **FR-027**: A paginação DEVE se basear na ordem temporal dos identificadores, sem contagem total e sem
  deslocamento numérico.

**Primeiro administrador (TRV-09)**

- **FR-028**: O sistema DEVE oferecer um comando de terminal para criar o primeiro administrador, pedindo a senha sem
  exibi-la e aplicando a política de senha da API.
- **FR-029**: O comando DEVE recusar a criação se já houver administrador ativo, salvo com opção explícita de forçar.
  Toda criação DEVE ser auditada como ação do sistema.
- **FR-030**: O administrador DEVE ser criado sem segundo fator cadastrado, estado que obriga o cadastro do segundo
  fator no primeiro login. A exigência no login é verificada na tarefa AUTH-03.
- **FR-031**: O comando DEVE funcionar dentro do container de produção.

**Base de testes (TRV-10)**

- **FR-032**: A base de testes DEVE subir a API com a mesma configuração de produção (prefixos, validação e
  tratamento de erros).
- **FR-033**: A base de testes DEVE oferecer geradores de usuário com perfis, categoria e denúncia já cifrada.
- **FR-034**: A limpeza entre suítes DEVE respeitar a auditoria imutável (banco ou schema descartável por suíte).
- **FR-035**: A base de testes DEVE reduzir o custo do hash de senha só no ambiente de teste.
- **FR-036**: A base de testes DEVE permitir capturar as linhas de log de uma requisição.

**Contrato da API (TRV-11)**

- **FR-037**: A documentação da API DEVE separar as áreas pública e administrativa e mostrar os formatos de entrada e
  saída, só fora de produção.
- **FR-038**: O projeto DEVE ter um comando local que grava o contrato da API em arquivos versionados no repositório,
  um para a área pública e outro para a área administrativa, sem depender de banco, rede ou do pipeline. O front gera
  dois clientes separados a partir deles.
- **FR-038a**: O pipeline de integração contínua DEVE regenerar o contrato, falhar se ele divergir do que está
  versionado e publicá-lo como artefato.

**Proxy reverso (TRV-12)**

- **FR-039**: O projeto DEVE ter uma configuração de referência do proxy reverso sem registro de acesso nas rotas
  públicas e com registro de acesso com endereço permitido só nas rotas administrativas.
- **FR-040**: A configuração de referência DEVE usar transporte seguro 1.2 ou superior (de preferência 1.3), instruir
  o navegador a usar sempre conexão segura e ter limite de corpo compatível com os anexos.
- **FR-041**: A configuração de referência DEVE remover o cabeçalho de endereço de origem das rotas públicas antes de
  chegarem à API.

### Privacy & Security _(mandatory)_

- **Personal or sensitive data handled**: esta feature não cria dados de negócio. Ela trata dados sensíveis em
  trânsito: corpos de requisição que podem conter relato ou senha (FR-004, FR-008), chaves de dados e valores em claro
  vindos do serviço de chaves (FR-015) e os segredos de configuração (FR-009 a FR-011). Nenhum desses dados é
  persistido por esta feature.
- **Anonymity impact**: define as regras que toda rota pública vai seguir: prefixo próprio, nenhum parâmetro de
  caminho além do identificador de anexo, nenhum cookie e nenhum cache (FR-022 a FR-025). O tratamento de erros não
  copia corpo nem cabeçalhos para o log (FR-004). A referência de proxy remove o endereço de origem e desliga o
  registro de acesso público (FR-039 a FR-041). Nenhum IP, user-agent ou cabeçalho do denunciante é guardado.
- **Encryption**: N/A para campos, porque esta feature não grava dados cifrados. Ela entrega o acesso ao serviço de
  chaves (FR-012 a FR-015) que o módulo de criptografia vai usar com `report-kek` e `app-kek`. A `identity-kek` fica
  fora do alcance da API (D24).
- **Access**: N/A. Esta feature não cria rotas de negócio. As convenções de rota administrativa preparam o terreno
  para as permissões declaradas por rota, que vêm no módulo de controle de acesso.
- **Audit events**: `USER_CREATED` com ator `SYSTEM` na criação do primeiro administrador (FR-029). Nenhum outro evento. Os outros componentes não auditam porque quem audita é o módulo que os chama.
- **Retention**: N/A. Nenhum dado de denúncia é guardado. A fila guarda só identificadores, com histórico limitado
  (FR-017, FR-018).

### Key Entities _(include if feature involves data)_

- **Erro da API**: código, tipo, mensagem e identificador da requisição. Nunca contém dado de entrada.
- **Página de listagem**: itens e cursor da página seguinte, este último derivado do identificador ordenável do
  último item.
- **Job**: tarefa assíncrona identificada pela própria tarefa, com tentativas e histórico limitados, contendo só
  identificadores.
- **Chave de dados**: chave gerada pelo serviço de chaves, com uma versão em claro (só em memória) e uma versão
  protegida (para guardar).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Em 100% dos testes de erro (400, 401, 403, 404, 409 e 500), a resposta segue o formato único e não
  contém nenhum trecho do corpo enviado.
- **SC-002**: Nenhuma linha de log gerada nos testes de rotas públicas contém endereço IP, user-agent, cabeçalho ou
  texto de relato.
- **SC-003**: A verificação automática de rotas cobre 100% das rotas públicas registradas e falha em menos de um
  ciclo de integração contínua quando uma rota fora da regra é adicionada.
- **SC-004**: 100% das configurações inseguras de produção testadas (credencial de administrador total, falta de
  credencial de aplicação, segredo curto) impedem a inicialização.
- **SC-005**: Com o serviço de chaves indisponível, 100% das requisições que dependem dele recebem resposta de
  indisponibilidade em até 3 segundos.
- **SC-006**: A navegação por todas as páginas de uma lista com inserções concorrentes não repete nem perde nenhum
  item.
- **SC-007**: Um job enfileirado duas vezes com a mesma identidade produz efeito uma única vez.
- **SC-008**: O contrato da API é publicado em 100% das execuções do pipeline e permite gerar o cliente do front sem
  ajuste manual.
- **SC-009**: Um teste novo de "não vazou no log" pode ser escrito usando só a base de testes, sem preparar
  infraestrutura à mão.

## Assumptions

- A escolha das bibliotecas (validação, cliente do serviço de chaves, armazenamento de arquivos) é uma decisão de
  plano. Ela será registrada no registro de decisões antes do código, conforme o princípio IX da constituição.
- O serviço de chaves, a fila, o armazenamento de arquivos, o e-mail e o antivírus já existem no ambiente de
  desenvolvimento (`docker-compose.yml`) e são os mesmos usados pelos testes de integração.
- O identificador da requisição já é gerado pelo log atual e é reaproveitado no corpo de erro.
- O limite de tamanho padrão de texto livre será definido por recurso. Esta feature fornece o mecanismo e um limite
  padrão conservador para campos sem limite próprio.
- Spam e abuso nas rotas públicas estão fora do escopo (D15). Esta feature não inclui limite de requisições públicas.
- Nenhuma tarefa de outro arquivo do backlog (crypto, audit e demais) faz parte desta feature.
