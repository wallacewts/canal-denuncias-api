# Feature Specification: Criptografia em envelope dos dados sensíveis

**Feature Branch**: `main` (nenhuma branch criada: não há hook `before_specify` registrado)

**Created**: 2026-11-28

**Status**: Draft

**Input**: User description: "Conteúdo de `docs/tarefas/01-crypto.md` (tarefas CRYPTO-01 a CRYPTO-08). Os IDs de
tarefa, os critérios de aceite e as decisões D08, D24, D26 e D28 de `docs/adr/README.md` valem como requisitos."

## Escopo

Esta feature entrega a camada de criptografia que todos os módulos que guardam dado sensível vão usar: o formato do
campo cifrado, a geração e abertura da chave de cada denúncia, uma forma única de selar e abrir registros (JSON e
texto), a cifragem de arquivos em streaming, a cifragem direta de segredos da aplicação, a rotação de chaves com
recifragem das chaves das denúncias, as políticas de acesso do serviço de chaves em produção e os testes que provam
que nenhum segredo vaza. É o segundo passo da ordem de implementação do backlog (fundação de segurança).

**Tarefas do backlog cobertas**: todas as 8 (CRYPTO-01 a CRYPTO-08), decidido em 2026-11-28. Inclui as três do
marco Produção: CRYPTO-04 (arquivos em streaming), CRYPTO-06 (rotação e recifragem) e CRYPTO-07 (políticas do serviço
de chaves em produção).

**O que já existe e é reaproveitado (feature 001, `specs/001-transversal-infrastructure`)**:

- O serviço de chaves (TRV-04, contrato `contracts/key-service.md`): gera e abre chaves de dados, cifra, decifra e
  recifra no serviço de chaves, com timeout, resposta de indisponibilidade e uma lista de chaves permitidas que
  **recusa a chave de identidade** (D24, D28). Esta feature usa esse serviço; não o reespecifica.
- A credencial de desenvolvimento da API no serviço de chaves, sem nenhum acesso à chave de identidade.
- As factories de teste que hoje cifram dados com uma implementação provisória (pendência I3 da feature 001). Esta
  feature as faz usar a camada oficial de criptografia.
- O comando de linha de comando da API (usado pelo `create-admin`), base para o comando de recifragem.

## Clarifications

### Session 2026-11-28

- Q: Quais tarefas de `01-crypto.md` entram nesta feature? → A: Todas as 8 (CRYPTO-01 a CRYPTO-08). As user stories 6
  a 8 fazem parte do escopo.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Campo cifrado que não pode ser lido nem trocado (Priority: P1)

O conteúdo de uma denúncia, de uma mensagem ou de uma nota fica guardado cifrado de um jeito que só abre com a chave
certa e no lugar certo. Quem tiver acesso ao banco, a um backup ou a um vazamento vê apenas bytes ilegíveis. Mesmo
quem conseguir mexer no banco não consegue copiar o texto cifrado de um registro para outro, nem alterar um byte sem
que isso seja detectado.

**Why this priority**: é a base de toda a proteção em repouso (princípio III da constituição). Sem um formato único e
verificável, cada módulo inventaria o seu, e um erro em qualquer um deles exporia denúncias.

**Independent Test**: cifrar e decifrar um valor; depois tentar abrir com o contexto de outro registro, com um byte
alterado, com a etiqueta de integridade alterada e com uma versão de formato desconhecida.

**Acceptance Scenarios**:

1. **Given** um texto e o contexto do registro (tabela, campo e id), **When** ele é cifrado e depois decifrado com o
   mesmo contexto, **Then** o texto original volta igual.
2. **Given** um valor cifrado para o registro A, **When** alguém tenta abri-lo com o contexto do registro B (outro id,
   outro campo ou outra tabela), **Then** a abertura falha.
3. **Given** um valor cifrado, **When** qualquer byte do conteúdo ou da etiqueta de integridade é alterado, **Then** a
   abertura falha.
4. **Given** um valor com uma versão de formato que o sistema não conhece, **When** se tenta abri-lo, **Then** a
   abertura falha com erro de formato, sem tentar adivinhar.
5. **Given** o mesmo texto cifrado duas vezes com a mesma chave, **When** os dois resultados são comparados, **Then**
   são diferentes (o valor aleatório de cada cifragem nunca se repete).

---

### User Story 2 - Uma chave por denúncia, que só existe em claro durante o uso (Priority: P1)

Cada denúncia tem uma chave de dados própria. Essa chave fica guardada protegida pela chave mestra das denúncias, no
serviço de chaves, e só aparece em claro durante a operação que precisa dela. Terminada a operação, ela é apagada da
memória. A chave mestra nunca sai do serviço de chaves.

**Why this priority**: é o que torna possível o expurgo por destruição de chave (crypto-shredding) e limita o estrago
de qualquer exposição a uma única denúncia. Sem ela, nenhum módulo de denúncia pode gravar conteúdo.

**Independent Test**: criar uma chave de dados, guardar a versão protegida, abrir de novo e cifrar com ela; conferir
que a chave em claro foi zerada ao fim da operação, inclusive quando a operação falha.

**Acceptance Scenarios**:

1. **Given** uma nova denúncia, **When** o sistema pede uma chave de dados, **Then** recebe a chave em claro e a
   versão protegida, e só a versão protegida pode ser guardada no banco.
2. **Given** uma chave protegida guardada, **When** o sistema pede para abri-la, **Then** recebe a chave em claro, que
   abre os dados cifrados com ela.
3. **Given** uma operação que usa a chave em claro, **When** a operação termina com sucesso ou com erro, **Then** a
   chave em claro é zerada na memória.
4. **Given** uma operação que precisa do serviço de chaves e também grava no banco, **When** ela é executada, **Then**
   a chamada ao serviço de chaves acontece antes de a transação do banco ser aberta.
5. **Given** o serviço de chaves fora do ar, **When** uma chave é pedida, **Then** a operação falha com a resposta de
   indisponibilidade já definida na feature 001, sem dado sensível na mensagem.

---

### User Story 3 - Selar e abrir registros de um jeito só (Priority: P1)

Quem desenvolve os módulos de denúncias, mensagens, tratativa e identidade sela e abre os dados por uma única
interface: objetos estruturados (como o conteúdo de uma denúncia) e textos livres (mensagens, notas e
justificativas). Ao abrir um objeto, o sistema confere se ele tem o formato esperado para a sua versão.

**Why this priority**: concentra num único lugar as regras de contexto, versão e validação. É o que os módulos do
MVP (reports, messages, case-management) vão chamar.

**Independent Test**: selar e abrir um objeto e um texto; tentar abrir um objeto de versão desconhecida; tentar abrir
a mensagem de um registro com o contexto de outro.

**Acceptance Scenarios**:

1. **Given** o conteúdo de uma denúncia no formato da versão 1, **When** ele é selado e aberto, **Then** volta igual e
   validado contra o formato da versão 1.
2. **Given** um objeto selado com uma versão que o sistema não conhece, **When** se tenta abri-lo, **Then** a abertura
   falha.
3. **Given** duas mensagens cifradas com a mesma chave, **When** o texto cifrado de uma é aberto com o contexto da
   outra, **Then** a abertura falha.
4. **Given** um registro novo que terá conteúdo cifrado, **When** ele é criado, **Then** o seu identificador é gerado
   pela aplicação antes da gravação, porque o contexto da cifragem precisa dele.

---

### User Story 4 - Segredos da aplicação cifrados no serviço de chaves (Priority: P1)

Segredos pequenos da aplicação, como o segredo do segundo fator de cada membro da equipe, são cifrados diretamente
pelo serviço de chaves, com a chave mestra da aplicação. Eles nunca ficam em claro no banco.

**Why this priority**: o cadastro do segundo fator (AUTH) depende disso, e o login com MFA está no MVP.

**Independent Test**: cifrar e decifrar um segredo pelo serviço de chaves do ambiente local.

**Acceptance Scenarios**:

1. **Given** um segredo de segundo fator, **When** ele é cifrado e decifrado, **Then** volta igual.
2. **Given** um segredo cifrado, **When** se olha o valor guardado, **Then** ele não contém o segredo em claro.

---

### User Story 5 - Nenhum segredo vaza em erro ou log (Priority: P1)

Quando algo falha na criptografia (contexto errado, dado adulterado, serviço de chaves fora do ar), nem a resposta da
API nem os logs trazem o texto em claro, a chave de dados ou o texto cifrado.

**Why this priority**: um erro que repete o que estava sendo cifrado anula toda a proteção (princípios II e III). É
uma regra de segurança e, pela constituição, precisa de teste que falha se for quebrada.

**Independent Test**: forçar cada tipo de falha com conteúdos curtos e longos e procurar esses conteúdos na resposta e
nas linhas de log.

**Acceptance Scenarios**:

1. **Given** um texto curto e um texto longo de relato, **When** a abertura falha por contexto errado ou por dado
   adulterado, **Then** nem a resposta nem o log contêm o texto, a chave de dados ou o texto cifrado.
2. **Given** o serviço de chaves fora do ar, **When** uma operação de cifragem é tentada, **Then** a resposta é a de
   indisponibilidade e o log não contém dado sensível.
3. **Given** as factories de teste da feature 001, **When** elas criam uma denúncia cifrada, **Then** usam a camada
   oficial de criptografia, e a denúncia criada abre pela mesma interface que os módulos vão usar.

---

### User Story 6 - Arquivos cifrados em streaming (Priority: P2)

Os anexos das denúncias são cifrados e decifrados aos pedaços, sem carregar o arquivo inteiro na memória. Um arquivo
cortado ou alterado não abre.

**Why this priority**: necessário para anexos (marco Produção). Não bloqueia o MVP.

**Independent Test**: cifrar e decifrar um arquivo de 10 MB acompanhando o uso de memória; truncar e alterar o
arquivo cifrado e tentar abrir.

**Acceptance Scenarios**:

1. **Given** um arquivo de 10 MB, **When** ele é cifrado e decifrado, **Then** volta íntegro e o uso de memória fica
   estável durante o processo.
2. **Given** um arquivo cifrado, **When** ele é cortado no meio ou tem um byte alterado, **Then** a decifragem falha.
3. **Given** um arquivo sendo cifrado, **When** a gravação termina, **Then** o sistema tem o resumo de integridade
   (hash) do arquivo cifrado para guardar junto com o anexo.

---

### User Story 7 - Rotação de chaves sem tocar no conteúdo (Priority: P2)

A operação consegue girar a chave mestra das denúncias e, em seguida, recifrar todas as chaves de dados guardadas
com a versão nova, sem abrir nem alterar o conteúdo cifrado. O processo pode ser interrompido e retomado.

**Why this priority**: necessária antes da produção (rotação periódica e resposta a incidente). Não bloqueia o MVP.

**Independent Test**: criar denúncias, girar a chave mestra, rodar a recifragem, conferir que o conteúdo cifrado não
mudou e que as denúncias antigas continuam abrindo.

**Acceptance Scenarios**:

1. **Given** denúncias com chaves protegidas pela versão anterior da chave mestra, **When** a chave mestra é girada e
   a recifragem roda, **Then** todas as chaves passam para a versão nova e as denúncias continuam abrindo.
2. **Given** uma recifragem interrompida no meio, **When** ela é executada de novo, **Then** termina sem erro e sem
   recifrar duas vezes o que já foi feito.
3. **Given** a recifragem, **When** ela termina, **Then** o conteúdo cifrado das denúncias não foi alterado.
4. **Given** a recifragem, **When** ela termina, **Then** a trilha de auditoria registra a execução com ator
   "sistema", a chave mestra e a quantidade de registros, sem nenhum dado de denúncia.

---

### User Story 8 - Acesso mínimo ao serviço de chaves em produção (Priority: P3)

O time de operação tem um passo a passo documentado para inicializar o serviço de chaves em produção, com abertura
compartilhada entre várias pessoas, backup e registro de auditoria do próprio serviço. As políticas de acesso dão à
API só o que ela precisa e garantem que a API não acessa a chave de identidade.

**Why this priority**: documentação e configuração para a produção. Não bloqueia o desenvolvimento.

**Independent Test**: aplicar as políticas num serviço de chaves de teste e conferir que a credencial da API consegue
o que precisa e recebe recusa no resto.

**Acceptance Scenarios**:

1. **Given** a política da API, **When** a API tenta gerar e abrir chaves de denúncia e cifrar segredos da aplicação,
   **Then** consegue.
2. **Given** a política da API, **When** a API tenta qualquer operação na chave de identidade, ou tenta recifrar
   chaves, **Then** recebe recusa.
3. **Given** o perfil de manutenção, **When** ele roda a recifragem, **Then** consegue.
4. **Given** o passo a passo de produção, **When** a operação o segue, **Then** o serviço de chaves fica com abertura
   compartilhada, backup documentado e registro de auditoria próprio ligado.

---

### Edge Cases

- A chave de dados protegida guardada no banco foi corrompida ou pertence a outra chave mestra: a abertura falha
  com erro genérico, sem expor o valor guardado.
- A chave de dados de uma denúncia já foi destruída pelo expurgo: a operação falha de forma previsível ("conteúdo
  indisponível"), sem tentar abrir.
- Pedido de chave para a chave de identidade dentro da API: recusado antes de qualquer chamada de rede (comportamento
  da feature 001, coberto por teste nesta feature).
- Valor cifrado vazio, curto demais para conter cabeçalho e etiqueta, ou com tamanho impossível: falha de formato.
- Texto em claro vazio: pode ser cifrado e decifrado (o sistema não confunde "vazio" com "ausente").
- Objeto que abre corretamente, mas não segue o formato da sua versão (campo faltando ou a mais): a abertura falha na
  validação, sem devolver o objeto parcial.
- Serviço de chaves volta ao ar durante uma recifragem longa: a recifragem retoma do ponto em que parou.
- Arquivo vazio como anexo: cifra e decifra sem erro.

## Requirements _(mandatory)_

### Functional Requirements

**Formato do campo cifrado (CRYPTO-01)**

- **FR-001**: O sistema DEVE guardar cada valor cifrado num formato único e versionado, composto de versão, valor
  aleatório de cifragem, conteúdo cifrado e etiqueta de integridade, usando criptografia autenticada de 256 bits
  (AES-256-GCM, conforme D08 e a constituição).
- **FR-002**: Toda cifragem DEVE usar um contexto obrigatório no formato `"<tabela>.<campo>:<id do registro>"`,
  montado por um único ponto do sistema, e a abertura DEVE falhar se o contexto for diferente.
- **FR-003**: Cada cifragem DEVE usar um valor aleatório novo, nunca reaproveitado.
- **FR-004**: A abertura DEVE falhar se qualquer byte do conteúdo ou da etiqueta for alterado, se a versão for
  desconhecida ou se o tamanho for impossível.

**Chave de dados por denúncia (CRYPTO-02)**

- **FR-005**: O sistema DEVE gerar, pelo serviço de chaves, uma chave de dados por denúncia, recebendo a chave em
  claro e a versão protegida pela chave mestra das denúncias. Só a versão protegida pode ser persistida.
- **FR-006**: O sistema DEVE abrir uma chave protegida pelo serviço de chaves.
- **FR-007**: A chave em claro DEVE existir só durante a operação que a usa e ser zerada na memória ao fim dela,
  com sucesso ou com erro.
- **FR-008**: Não DEVE haver cache de chaves de dados em memória nesta feature. A latência é medida, e a decisão de
  cache fica para depois (registrada como decisão).
- **FR-009**: As chamadas ao serviço de chaves DEVEM acontecer antes de abrir uma transação no banco.
- **FR-010**: Dentro da API, a geração e a abertura de chaves de dados DEVEM aceitar só a chave mestra das denúncias.
  A chave de identidade continua recusada (D24); a cifragem da identidade é responsabilidade do serviço isolado de
  identidade (IDV-06), que reaproveita o mesmo formato de campo cifrado.

**Selar e abrir registros (CRYPTO-03)**

- **FR-011**: O sistema DEVE oferecer uma interface única para selar e abrir objetos estruturados, validando o
  objeto aberto contra o formato da sua versão (ex.: conteúdo da denúncia versão 1).
- **FR-012**: O sistema DEVE oferecer a mesma interface para textos livres (mensagens, notas e justificativas).
- **FR-013**: A abertura de um objeto de versão desconhecida ou fora do formato da versão DEVE falhar, sem devolver
  conteúdo parcial.
- **FR-014**: Registros com conteúdo cifrado DEVEM ter o identificador gerado pela aplicação antes da gravação. A
  geração automática pelo banco continua como reserva para os demais casos.

**Arquivos em streaming (CRYPTO-04)**

- **FR-015**: O sistema DEVE cifrar e decifrar arquivos aos pedaços, sem carregar o arquivo inteiro na memória, num
  formato documentado.
- **FR-016**: Durante a cifragem, o sistema DEVE calcular o resumo de integridade do arquivo cifrado.
- **FR-017**: A decifragem DEVE falhar se o arquivo cifrado for cortado ou alterado.

**Segredos da aplicação (CRYPTO-05)**

- **FR-018**: O sistema DEVE cifrar e decifrar segredos pequenos da aplicação (como o segredo do segundo fator)
  diretamente no serviço de chaves, com a chave mestra da aplicação.

**Rotação e recifragem (CRYPTO-06)**

- **FR-019**: O sistema DEVE oferecer um comando que percorre, em lotes, as chaves de dados protegidas das denúncias e
  troca cada uma pela versão recifrada com a versão atual da chave mestra, sem tocar no conteúdo cifrado.
- **FR-020**: A recifragem DEVE ser idempotente e retomável.
- **FR-021**: Cada lote recifrado DEVE ser registrado na trilha de auditoria na mesma transação das suas gravações, e
  cada execução DEVE ter um registro-resumo, sempre com ator "sistema", a chave mestra e a quantidade de registros, sem
  dado de denúncia.
- **FR-022**: Dentro da API, a recifragem cobre só a chave mestra das denúncias. A recifragem das chaves de identidade
  fica com o serviço isolado de identidade (IDV-06).

**Políticas de produção (CRYPTO-07)**

- **FR-023**: O projeto DEVE documentar as políticas de acesso do serviço de chaves em produção: a API com acesso
  mínimo (gerar e abrir chaves de denúncia, cifrar e decifrar segredos da aplicação), recifragem só para o perfil de
  manutenção e nenhuma permissão da API na chave de identidade.
- **FR-024**: O projeto DEVE documentar o passo a passo de inicialização em produção: abertura compartilhada entre
  várias pessoas, backup e registro de auditoria do próprio serviço de chaves.

**Não vazamento (CRYPTO-08)**

- **FR-025**: Nenhum erro de cifragem, de abertura ou do serviço de chaves DEVE incluir texto em claro, chave de dados,
  texto cifrado ou valor protegido na mensagem, nas propriedades do erro ou no log.
- **FR-026**: Testes automatizados DEVEM forçar as falhas (contexto errado, dado adulterado, versão desconhecida,
  serviço de chaves fora do ar), com conteúdos curtos e longos, e verificar a resposta e o log.
- **FR-027**: As factories de teste que criam dados cifrados DEVEM usar a camada oficial de criptografia (fecha a
  pendência I3 da feature 001).

### Privacy & Security _(mandatory)_

- **Personal or sensitive data handled**: nenhum dado novo é coletado. A feature protege todo o conteúdo sensível
  que os outros módulos vão guardar: relato da denúncia, mensagens, notas internas, justificativas, nomes de anexos,
  os próprios anexos e os segredos de segundo fator da equipe.
- **Anonymity impact**: nenhuma rota pública é criada ou alterada. As operações desta feature não recebem nem
  registram IP, user-agent ou cabeçalhos. A recifragem roda por linha de comando, com ator "sistema" e sem IP.
- **Encryption**: o formato de campo cifrado (FR-001 a FR-004) protege os dados com chave de dados por denúncia
  (`report-kek`). Os segredos da aplicação usam a `app-kek` (FR-018). A `identity-kek` fica fora do alcance da API
  (D24): a cifragem da identidade é do serviço isolado (IDV-06).
- **Access**: não há rota de negócio nem permissão nova. O acesso ao serviço de chaves segue o princípio do mínimo
  necessário (FR-023), com recifragem restrita ao perfil de manutenção.
- **Audit events**: `KEYS_REWRAPPED` por lote, na transação das gravações do lote, e `KEYS_REWRAP_RUN` por execução
  (ator "sistema"; chave mestra no recurso; metadata só com quantidades). Nenhum
  conteúdo, chave ou valor protegido na metadata.
- **Retention**: esta feature viabiliza o expurgo por destruição de chave (crypto-shredding), que será executado pela
  feature de retenção (RET-02). Os backups mantidos por tempo indeterminado (D26) continuam contendo as chaves
  protegidas das denúncias já expurgadas; esse risco continua registrado e não é resolvido nesta feature.

### Key Entities _(include if feature involves data)_

- **Valor cifrado**: bytes guardados nas colunas cifradas já existentes (`content_enc`, `body_enc`,
  `justification_enc`, `reason_enc`, `original_name_enc`, `payload_enc`). Contém versão, valor aleatório, conteúdo
  cifrado e etiqueta.
- **Contexto de cifragem**: tabela, campo e id do registro. Não é guardado; é recalculado na abertura.
- **Chave de dados**: uma por denúncia. A versão protegida fica em `reports.wrapped_dek`; a versão em claro só existe
  em memória durante a operação.
- **Segredo da aplicação**: valor cifrado diretamente pelo serviço de chaves (ex.: `users.mfa_secret_enc`).
- **Arquivo cifrado**: anexo cifrado aos pedaços, com cabeçalho de formato e resumo de integridade
  (`attachments.ciphertext_hash`).
- **Execução de recifragem**: registrada só na trilha de auditoria; não há tabela nova.

Nenhuma tabela nova é necessária: as colunas cifradas já existem desde o esqueleto.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% das tentativas de abrir um valor com contexto de outro registro, com qualquer byte alterado ou com
  versão desconhecida falham nos testes automatizados.
- **SC-002**: Em 100% dos cenários de falha testados (com conteúdo curto e longo), nenhum trecho do texto em claro, da
  chave de dados ou do texto cifrado aparece na resposta ou no log.
- **SC-003**: Selar e abrir o conteúdo de uma denúncia, incluindo a abertura da chave no serviço de chaves do ambiente
  local, leva no máximo 100 ms no percentil 95, medido nos testes de integração, para servir de base à decisão sobre
  cache de chaves.
- **SC-004**: Um arquivo de 10 MB é cifrado e decifrado íntegro, com o pico de memória do processo crescendo menos de
  5 MB durante a operação.
- **SC-005**: Depois de girar a chave mestra e rodar a recifragem, 100% das denúncias de teste continuam abrindo e 0
  bytes do conteúdo cifrado mudam.
- **SC-006**: A credencial da API recebe recusa do serviço de chaves em 100% das tentativas de usar a chave de
  identidade ou de recifrar chaves fora do perfil de manutenção.
- **SC-007**: A cobertura de testes do código desta feature fica em pelo menos 80% (princípio VII).

## Assumptions

- O serviço de chaves da feature 001 (TRV-04) é usado como está; ajustes nele, se necessários, entram como tarefa
  explícita no plano.
- O conteúdo da denúncia versão 1 segue o formato já definido no projeto (`ReportContentV1`).
- A escolha do formato de arquivo cifrado (cabeçalho com tag no fim ou blocos com tag própria) fica para o plano,
  desde que atenda FR-015 a FR-017.
- A meta de latência (SC-003) é medida no ambiente local com o serviço de chaves do docker-compose; o número de
  produção será reavaliado.
- O perfil de manutenção (para a recifragem) é uma credencial separada da API, criada no ambiente local para os
  testes e documentada para produção.
- A destruição de versões antigas da chave mestra, que tornaria ilegíveis as denúncias expurgadas presentes em
  backups antigos (D26), não faz parte desta feature; fica para a decisão da feature de retenção.
- O trabalho segue na `main`, sem branch de feature (decisão do usuário).
