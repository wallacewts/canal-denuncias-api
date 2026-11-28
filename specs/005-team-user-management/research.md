# Research: Gestão da equipe interna e meu perfil

Decisões técnicas da feature 005, conferidas no código atual e nos pacotes instalados (`@nestjs/authentication` 0.1.8,
`@nestjs/authorization` 0.1.4). Nenhum ponto ficou em aberto.

## R1. Fonte única do catálogo de habilidades

**Decision**: um módulo de dados só, `src/modules/access-control/abilities.ts`, com o catálogo fechado de códigos
`recurso.ação` da matriz do ACL-01. Cada entrada traz os perfis que a concedem e se ela é global ou "por registro". Dele
saem `abilitiesFor(roles)` (lista ordenada, para o `/me`) e `hasAbility(user, código)` (para as políticas). As
políticas desta feature (`UsersPolicy`) e a checagem do Auditor que já existe no `AuditController` passam a consultar o
catálogo; as políticas do ACL-01 a ACL-05 farão o mesmo.

Catálogo (uma linha da matriz pode virar mais de um código quando junta duas coisas):

| Código              | Linha da matriz do ACL-01                         | Perfis                | Escopo       |
| ------------------- | ------------------------------------------------- | --------------------- | ------------ |
| `users.manage`      | Gerenciar usuários e categorias                   | ADMIN                 | global       |
| `categories.manage` | Gerenciar usuários e categorias                   | ADMIN                 | global       |
| `settings.sla`      | Alterar SLA                                       | ADMIN                 | global       |
| `retention.manage`  | Alterar retenção e legal hold                     | DPO                   | por registro |
| `reports.list`      | Listar todas / listar atribuídas a si             | Gestor, DPO, Analista | por registro |
| `reports.read`      | Ver conteúdo da denúncia                          | Gestor, DPO, Analista | por registro |
| `reports.triage`    | Triar, atribuir, priorizar, bloquear por conflito | Gestor                | por registro |
| `reports.treat`     | Mudar status, mensagens e notas                   | Gestor, Analista      | por registro |
| `identity.request`  | Pedir revelação de identidade                     | Gestor, Analista      | por registro |
| `identity.approve`  | Aprovar ou rejeitar revelação                     | DPO                   | por registro |
| `audit.read`        | Ver trilha de auditoria                           | AUDITOR               | global       |
| `dashboard.read`    | Ver indicadores                                   | Gestor, DPO, AUDITOR  | global       |

Os nove códigos citados no contrato do front (`reports.list`, `reports.read`, `reports.triage`, `users.manage`,
`audit.read`, `settings.sla`, `retention.manage`, `identity.approve`, `dashboard.read`) estão todos no catálogo, com o
mesmo nome. "Por registro" significa que a pessoa pode exercer a habilidade em algum registro; a decisão final continua
no servidor (atribuição, conflito de interesse, expurgo).

**Formato dos códigos**: `^[a-z][a-z-]*\.[a-z][a-z-]*$` (recurso e ação em minúsculas, hífen permitido), o mesmo que
o front valida em tempo de execução; código novo é aditivo, renomear ou remover é mudança incompatível.

**Testes de concordância** (escritos antes):

1. Unitário em tabela: perfil × código, com o esperado copiado da matriz do ACL-01.
2. Documento × código: lê a tabela da matriz em `docs/tarefas/05-access-control.md` e falha se uma linha mudar sem o
   catálogo mudar (rótulo da linha → códigos, mapa no próprio teste).
3. e2e: para cada perfil (e uma combinação), o `/me` devolve `users.manage` se e somente se as rotas de equipe
   respondem 200, e `audit.read` se e somente se a trilha responde 200.
4. Convenção: toda habilidade usada por política existe no catálogo (o tipo do código é a união dos códigos; o
   compilador recusa código desconhecido).

**Rationale**: o `/me` e as regras do servidor não podem divergir (SC-005); um catálogo em dados é fácil de testar
contra a matriz e não exige que as políticas do ACL-01 existam para o `/me` responder (Q2 = A).

**Alternatives considered**:

- Derivar o `/me` perguntando a cada política (`can()` sem registro): exigiria as políticas do ACL-01 prontas e
  registros fictícios para as habilidades por registro. Rejeitada por agora; o teste 3 cobre a concordância nas rotas
  que já existem e o ACL-01 estende.
- Catálogo no front: proibido pelo USERS-07 (o front não copia a matriz).

## R2. Derrubar as sessões na hora ao bloquear ou desativar

**Decision**: a mudança de status e o registro `USER_STATUS_CHANGED` acontecem numa transação; depois do commit, o
serviço chama `SessionService.revokeAll(userId)` do pacote. Na reativação, `revokeAll` é chamado **antes** da
transação que volta o status para ativo.

- O corte é imediato já no commit: o `StaffSessionProvider` relê o status a cada requisição e só aceita `ACTIVE`
  (feature 004). O `revokeAll` apaga as sessões para que uma reativação não ressuscite nenhuma delas.
- `revokeAll` já trata a corrida com a troca de id da sessão (repete as remoções até não sobrar nenhuma) e não emite
  evento.
- Se o `revokeAll` falhar depois do commit, a pessoa continua sem acesso (status) e a reativação chama `revokeAll` de
  novo antes de liberar; o erro é logado só com o nome.

**Rationale**: o acesso cai na hora sem depender da limpeza, e nenhuma sessão antiga volta (cenário 2 da US3).

**Alternatives considered**:

- `SignInService.signOutEverywhere`: emite `sign-out` com `everywhere`, que o assinante grava como
  `AUTH_SESSION_REVOKED` com a **pessoa alvo** como ator; a ação foi do Administrador. Rejeitada.
- `DELETE` direto na transação: não trata a corrida com a rotação do id (o próprio pacote documenta o caso).

## R3. Nunca sem Administrador ativo, sob concorrência

**Decision**: toda operação que pode reduzir os Administradores ativos (mudar status de um Administrador, retirar o
perfil ADMIN) roda numa transação que começa com `pg_advisory_xact_lock(ADMIN_LOCK)`, a mesma chave do `create-admin`
(constante movida para `src/modules/users/`), aplica a mudança, conta os Administradores ativos com
`countActiveAdmins(manager)` e desfaz com 409 `LAST_ACTIVE_ADMIN` se a contagem for zero.

Toda operação de escrita sobre outra pessoa (nome, status, perfis, reset do MFA) também trava, numa só consulta e em
ordem de id, as linhas de quem age e do alvo (`FOR UPDATE`), e confere de novo quem age: se deixou de estar ativo ou
de ser Administrador desde o início da requisição, recusa com 403 e nada muda (um Administrador bloqueado no meio de
uma requisição não aplica a mudança). Travar as duas linhas na mesma consulta e em ordem evita impasse entre duas
pessoas agindo uma sobre a outra.

Consequência: pela API, quem age é sempre um Administrador ativo e não age sobre si, então uma operação isolada nunca
zera os Administradores; com duas simultâneas (A e B retirando um ao outro), a segunda vê que quem age não é mais
Administrador (403) ou que não sobraria nenhum (409). O 409 continua como defesa da própria operação e é provado num
teste de integração que chama o serviço direto.

**Rationale**: o lock serializa só essas operações (raras) e a contagem vê o estado já alterado; duas operações
simultâneas que juntas zerariam os Administradores não passam as duas. É o mesmo mecanismo já provado no
`create-admin`.

**Alternatives considered**: `SERIALIZABLE` com retentativa (mais código e erros de serialização em todas as
operações); trigger no banco (regra entre linhas de duas tabelas, difícil de testar e de explicar no 409).

## R4. Denúncias atribuídas ao desativar ou retirar o perfil de Analista (Q1 = A)

**Decision**: na mesma transação da mudança, a operação conta as denúncias **abertas** atribuídas à pessoa
(`assigned_to_id` = ela e status fora de `CONCLUDED`, `INVALID` e `ARCHIVED`) e, se houver alguma, desfaz com 409
`USER_HAS_ASSIGNED_REPORTS` e `details.assignedReports` = quantidade. A linha da pessoa é travada (`FOR UPDATE`) no
início da transação.

- Vale para status `DISABLED` e para retirar o perfil `ANALYST`. Bloquear (`BLOCKED`) nunca consulta atribuições.
- Denúncias encerradas guardam o analista como histórico e não impedem nada.
- A atribuição futura (case-management) deve travar a linha do analista (`FOR SHARE`) e recusar quem não está ativo ou
  não é Analista; fica registrado como premissa para aquela feature.

**Rationale**: decisão do usuário (Q1 = A); a trava evita que uma atribuição simultânea escape da contagem.

## R5. Senha provisória

**Decision**: gerada com `crypto.randomInt` sobre um alfabeto de 56 caracteres sem ambíguos (sem `0`, `O`, `1`, `l`,
`I`), 20 caracteres (≈116 bits), conferida com `checkPasswordPolicy` (a mesma do `create-admin`). O hash
(`PasswordHasher`, D32) é calculado **antes** da transação. A resposta 201 traz `temporaryPassword` uma única vez;
`password_changed_at` fica nulo, o que marca a troca obrigatória (regra do AUTH-05) e aparece como
`passwordChangeRequired: true` no `/me`. A área administrativa já responde com `Cache-Control: no-store`. A senha não
entra em log, auditoria nem mensagem de erro (teste com captura de log, inclusive em falha de cadastro por e-mail
repetido).

**Rationale**: a senha não depende da política do AUTH-05 (bem acima do mínimo) e nunca é guardada em claro.

**Alternatives considered**: link de definição de senha por e-mail (não há envio de e-mail nesta etapa; notificações
vêm depois); senha escolhida pelo Administrador (ele saberia a senha da outra pessoa por mais tempo).

## R6. Reset do MFA de outra pessoa

**Decision**: um método novo do `PgMfaStore`, `resetFor(userId, manager)`, apaga o autenticador (as mesmas colunas
que `saveTotp(null)` já limpa) e os códigos de recuperação **dentro da transação** que grava `USER_MFA_RESET`; depois
do commit, `SessionService.revokeAll(userId)`. Idempotente: sem MFA, a operação termina e registra do mesmo jeito.
O Administrador não reseta o próprio MFA (regra da `UsersPolicy`, 403 registrado).

**Rationale**: auditoria na mesma transação da alteração (princípio V). Nenhuma chamada ao Vault: só se apaga dado
selado.

**Alternatives considered**: `MfaService.disable(userId)` do pacote: faz duas escritas sem transação compartilhável e
emite `mfa-disabled` sem ator; a auditoria ficaria fora da transação. Rejeitada.

## R7. Meu perfil (`GET /me`) compatível com o front

**Decision**: rota `@AdminApi('me')` com `@Can.Anyone()` (qualquer pessoa com sessão verificada). Os dados vêm do
banco (usuário e perfis, já relidos pela sessão) e do registro da sessão atual (`@CurrentSession()` do pacote):

- `idleExpiresAt` = `lastActiveAt` + 15 min. O último uso é gravado no máximo uma vez por minuto, então o valor nunca
  passa da expiração real e pode vir até 1 min antes (SC-006).
- `absoluteExpiresAt` = `expiresAt` do registro da sessão (início + 8 h).
- Campos e nomes iguais ao `CurrentUser` do contrato do front (`contracts/me-api.md`): `mfaEnabledAt` (data ou nulo),
  `passwordChangeRequired`, `abilities`.

**Rationale**: o front já tem tipos e simulador com esse formato; nada de cálculo de expiração fora do registro da
sessão.

## R8. Erros com código estável

**Decision**: o corpo de erro (`ApiError`) ganha dois campos opcionais: `code` (texto estável em maiúsculas, por
exemplo `LAST_ACTIVE_ADMIN`, `USER_HAS_ASSIGNED_REPORTS`, `EMAIL_ALREADY_REGISTERED`) e `details` (só inteiros e
enums, por exemplo `{ assignedReports: 3 }`). Os erros existentes não mudam. Registrado no `docs/adr/README.md` antes
do código, junto com o catálogo de habilidades (R1).

**Rationale**: o front precisa distinguir os 409 (e o AUTH-05 vai usar o mesmo formato para
`CURRENT_PASSWORD_INVALID`); `details` sem texto livre mantém a regra de nunca ecoar valores.

## R9. Último login

**Decision**: um assinante dos eventos do pacote (o mesmo padrão do `AuthAuditSubscriber`) grava
`users.last_login_at` quando a entrada termina: `mfa-verified` ou `sign-in` com senha e sem MFA pendente.

**Rationale**: a entrada completa já é detectada por esses eventos (feature 004); as rotas reais de login (AUTH-01 a 04)
herdam o comportamento sem código novo.

## R10. Política da área de usuários

**Decision**: `UsersPolicy` em `src/modules/access-control/policies/users.policy.ts` (pasta prevista no ACL-01), com
as habilidades `manage` (precisa de `users.manage` no catálogo) e `actOnOther` (precisa de `users.manage` e de o alvo
não ser a própria pessoa; o id vem do parâmetro da rota, como no exemplo provado na feature 004). As negações viram
`ACCESS_DENIED` pelo assinante existente.

**Rationale**: primeira política real do sistema, no lugar que o ACL-01 já prevê; nenhum código de autorização novo
além da regra.
