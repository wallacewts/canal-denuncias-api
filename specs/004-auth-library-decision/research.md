# Research: Decisão das bibliotecas de autenticação e autorização

**Feature**: 004-auth-library-decision · **Data**: 2026-11-28

Evidências coletadas em 2026-11-28:

- Versões no npm: `@nestjs/authentication` 0.1.8 (26/11/2026), `@nestjs/authorization` 0.1.4 (13/11/2026),
  `passport` 0.7.0 (10/01/2025), `@nestjs/passport` 12.0.2, `passport-local` 1.0.0 (2023), `express-session` 1.19.0,
  `connect-pg-simple` 10.0.0, `otplib` 13.6.0, `@casl/ability` 7.1.3 (adaptadores oficiais só para Prisma e Mongoose;
  para TypeORM existe só `@cookiemonsterdev/casl-typeorm` 2.0.0, de comunidade).
- API real lida nos `.d.ts` do `@nestjs/authentication` 0.1.8 já instalado no projeto e do `@nestjs/authorization`
  0.1.4, `@casl/ability`, `@nestjs/passport`, `passport` e `otplib` instalados numa pasta temporária fora do
  repositório (`--ignore-scripts`).
- Experimento executado (script fora do repositório, Node 26.13.1, stores em memória do próprio pacote, relógio
  controlado):
  - `MfaService` com `encryption: false`: `confirm()` = `true`; o mesmo código aceito uma vez e **recusado** na segunda
    tentativa (proteção contra replay embutida).
  - `SessionService` com `idleTtl: '15m'`, `absoluteTtl: '8h'`: sessão válida após 14 min sem uso, **inválida** após
    mais 16 min sem uso; com uso a cada 10 min, **expira exatamente em 8 h**.
  - Cookie emitido: `__Host-sid=…; Max-Age=28800; Path=/; HttpOnly; Secure; SameSite=Lax` (o `SameSite` aceita
    `strict` pela opção `session.cookie.sameSite`).
- Skill do projeto `.claude/skills/nestjs-auth` (SKILL.md e references), conferida contra os `.d.ts` acima.

---

## R1. Autenticação: pacote oficial `@nestjs/authentication` (decidido: Q-P1 = A)

**Decision**: usar o `@nestjs/authentication` (versão exata 0.1.8, já fixada pela D32) com sessão por cookie
(`SessionCookieProvider`), MFA TOTP (`MfaService`) e o guard global do pacote, com **stores próprios em Postgres**
(definitivos, FR-023) e o segredo TOTP selado pelo `AppSecretService` (Vault, `app-kek`), não pela cifragem local do
pacote.

**Rationale**:

- Atende sozinho, conferido na API instalada e no experimento, a: segundo fator obrigatório (o guard trata sessão com
  `mfa: 'pending'` como não autenticada), comparação de senha em tempo constante inclusive para e-mail inexistente
  (`PasswordHasher.verify(senha, undefined)`), cookie `__Host-` `HttpOnly`/`Secure` com `SameSite` configurável,
  expiração por inatividade (`idleTtl`) e absoluta (`absoluteTtl`), troca do id da sessão no login e no MFA (contra
  fixação de sessão), recusa de subir em produção com store em memória, replay de TOTP, bloqueio após falhas de MFA
  (`maxAttempts`/`lockoutWindow`), códigos de recuperação com hash lento, eventos de auditoria
  (`AuthenticationEvents.events$`) e contexto do usuário por `AsyncLocalStorage` (`AuthenticationContext`), o mesmo
  mecanismo da D46.
- O que falta é **armazenamento**, que o pacote delega por contrato (`SessionStore`, `MfaStore`) com uma suíte de
  testes de contrato pronta (`authenticationStoreContract()` de `@nestjs/authentication/testing`, inclusive
  concorrência). Isso é trabalho de persistência, não de criptografia ou de protocolo.
- O hash de senha já é do pacote (D32): nenhuma migração de hash.
- Menos código próprio de segurança e nenhuma dependência de terceiros (o pacote não tem dependências de runtime).

**Extensões próprias necessárias** (o tamanho é estimativa de código de produção, sem testes):

| Extensão                            | O que é                                                                                                                                                                                                                                        | Tamanho         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `PgSessionStore`                    | Implementa `SessionStore` sobre a tabela `sessions` ajustada (R5): 4 métodos, cada um uma instrução SQL condicional                                                                                                                            | P (~80 linhas)  |
| `PgMfaStore`                        | Implementa `MfaStore` sobre `users` e `recovery_codes` e uma tabela de falhas (R5); 9 métodos, 4 deles escritas atômicas exigidas pelo contrato                                                                                                | M (~180 linhas) |
| Selagem do segredo TOTP             | Com `mfa.encryption: false` no pacote, o `PgMfaStore` sela o segredo com o `AppSecretService` (Vault, `app-kek`, preso ao usuário) antes de gravar e abre ao ler. Chamada ao Vault fora de transação (já é como o `AppSecretService` funciona) | P (~30 linhas)  |
| Ligação com a porta `AUTH_IDENTITY` | `SessionAuthIdentity` implementa `AuthIdentity.resolve()` lendo o `AuthenticationContext` (usuário e perfis recarregados do banco no `validate()` do provider)                                                                                 | P (~40 linhas)  |

Nenhuma extensão implementa criptografia, protocolo TOTP, comparação de senha ou geração de tokens.

**Alternatives considered**:

- **Passport + express-session + connect-pg-simple + otplib** (previsto no registro original): `passport-local` não é
  atualizado desde 2023; `express-session` faz expiração deslizante (`rolling`), mas a expiração absoluta de 8 h, a
  troca do id no MFA, a proteção contra replay de TOTP, o bloqueio por falhas de MFA, os códigos de recuperação com hash
  e a resposta em tempo constante para e-mail inexistente seriam **código próprio de segurança** (estimativa: G, com
  mais superfície de erro; a conta inicial de ~600 linhas incluía a renovação por tokens, que saiu na Q-P2). Mais
  dependências de terceiros e nenhuma suíte de contrato pronta. Maduro, mas exige escrever exatamente as partes mais
  delicadas.
- **Usar a cifragem local do pacote para o segredo TOTP** (`encryption: { keys }`): exigiria uma chave estática em
  variável de ambiente, contra a regra de chaves só no Vault (princípio III e D08). Rejeitado.

**Decidido pelo usuário (Q-P1 = A)**: pacotes oficiais para toda a autenticação e autorização.

**Risco aceito**: pacote em 0.1.x (mesmo risco já aceito pela D32). **Mitigação**: versão exata fixada, testes de
contrato do próprio pacote rodando contra os stores Postgres, testes de contrato do projeto (login, MFA, expirações,
autorização) reexecutados a cada atualização, e o ponto de saída preservado: a área administrativa depende da porta
`AUTH_IDENTITY` (D47), não do pacote; trocar de biblioteca troca só o adaptador e os stores.

## R2. Autorização: pacote oficial `@nestjs/authorization` (decidido: Q-P1 = A)

**Decision**: usar o `@nestjs/authorization` (versão exata 0.1.4) com políticas como providers, `@Can(Policy,
'habilidade')` nas rotas, `AuthorizationService.authorize()` nos serviços para checar o registro, e o guard global com
**negação por padrão**. O filtro de listagem (ACL-03) é escrito no repositório, a partir das mesmas regras.

**Rationale**:

- Negação por padrão nativa: rota sem `@Can()`, `@Can.Anyone()` ou `@Public()` responde 403, e a inicialização lista
  essas rotas (FR-016, princípio IV), verificado nos `.d.ts` (`PolicyRegistry`).
- Políticas são providers: podem injetar serviços (atribuição, conflito de interesse) para checar o registro (FR-017).
- Emite `AuthorizationEvents` (`denied`, com política e habilidade) para alimentar o `ACCESS_DENIED` da trilha
  (FR-020), sem código no caminho de cada rota.
- Coerente com R1: lê o usuário do `@nestjs/authentication` (dependência par `>=0.1.0`).
- O filtro na consulta precisa ser escrito à parte, **mas também precisaria com CASL**: o CASL não tem adaptador
  oficial para TypeORM, e converter regras em `WHERE` dependeria de `rulesToQuery` com código próprio ou de um pacote
  de comunidade. Com o pacote oficial, a regra fica num único lugar por recurso: o método da política (`canRead`) e o
  método do repositório (`findVisibleTo`) usam a mesma função de escopo, e um teste de propriedade confere que os dois
  concordam (R6).

**Alternatives considered**:

- **CASL (`@casl/ability` 7.1.3)**: expressivo para regras declarativas e com conversão para consulta em Prisma e
  Mongoose, que o projeto não usa. Sem negação por padrão nas rotas (exigiria guard próprio) e sem eventos de negação.
  Rejeitado por exigir mais código próprio sem eliminar o filtro manual.

## R3. Renovação (refresh tokens): não usar (decidido: Q-P2 revista para A)

**Decision**: a área administrativa usa **só sessão por cookie** no servidor, sem tokens de acesso nem de renovação.
A expiração por inatividade (15 min) desliza com o uso; a absoluta encerra em 8 h; o id da sessão é trocado no login,
na verificação do segundo fator e na troca de senha (`signInService.rotateSession()`); `revokeAll`/`signOutEverywhere`
encerra todas as sessões do usuário. O `AuthenticationModule` é configurado **sem** `accessToken` (logo, sem
`TokenService`, sem `RefreshTokenStore` e sem chave de assinatura).

**Rationale**: renovação com rotação e detecção de reuso por família existe para proteger tokens portadores guardados
fora do servidor. Com sessão no servidor, o cookie é opaco, `HttpOnly`, revogável na hora e guardado só como hash: não
há token portador a renovar. O papel da "família" fica com "todas as sessões do usuário" (`revokeAll`). Isso remove uma
classe inteira de segredo (tokens de renovação e a chave de assinatura dos tokens de acesso), duas tabelas e uma
superfície de ataque.

**Histórico da decisão**: o usuário escolheu primeiro manter a renovação (Q-P2 = B). O desenho correspondente pôs o par
de tokens num canal separado, só para clientes que não são navegador e emitido a partir de uma sessão já verificada
com MFA, porque usar tokens no navegador deixaria um token legível por JavaScript (contra o `HttpOnly` de D39 e
AUTH-02). Ao ver que esse canal não teria nenhum usuário hoje, o usuário decidiu tirá-lo (Q-P2 revista para A).

**Futuro**: um canal de tokens (acesso curto + renovação com detecção de reuso pelo `TokenService` do pacote e um
`RefreshTokenStore` em Postgres) pode ser criado depois, **por decisão própria registrada no ADR**, se surgir um
cliente que não seja navegador (ferramenta interna, integração). O desenho descartado fica registrado aqui como ponto
de partida: emissão só a partir de sessão verificada com MFA, entrega única no corpo da resposta, nenhuma rota do
navegador aceitando token portador, família com o mesmo teto de 8 h da sessão, segredo de assinatura fora do
repositório.

## R4. Guard global e rotas públicas

**Decision**: guard global do `@nestjs/authentication` ligado (`globalGuard: true`, padrão). O decorator
`@PublicApi()` passa a compor também `@Public()`; `/health`, `/ready` e o Swagger recebem `@Public()`. O
`AdminIdentityGuard` (D47) continua aplicado às rotas `@AdminApi`, agora alimentado pela sessão via `AUTH_IDENTITY`.

**Rationale**: duas camadas independentes: uma rota que esquecer os dois decorators fica fechada pelo guard global, e
o teste de convenção existente já exige `@PublicApi` ou `@AdminApi` em todo controller. A área pública nunca lê nem
emite cookie de sessão (princípio I): o guard global, com `@Public()`, não lê credenciais nessas rotas.

**Alternatives considered**: `globalGuard: false` e chamar o guard do pacote dentro do `AdminIdentityGuard`. Mais
simples de encaixar, mas perde a negação por padrão para rotas que não declararem área. Rejeitado.

## R5. Modelo de dados: ajuste de `sessions` e `recovery_codes`

**Decision**: migration escrita à mão (`AuthStores`) que ajusta as tabelas da feature 001 aos contratos do pacote
(detalhe em `data-model.md`):

- `sessions`: chave passa a ser o hash SHA-256 do token (`id varchar(64)`, gerado pelo pacote); colunas
  `last_active_at`, `expires_at`, `mfa` (pendente/verificada) e `metadata` (jsonb, só IP e user-agent da equipe);
  saem `refresh_token_hash`, `family_id` e `revoked_at` (revogação = `DELETE`; sem renovação por tokens, R3).
- `users`: `mfa_secret_enc` (já existe, selado pelo `AppSecretService`), `mfa_pending_secret_enc` (novo, para troca
  de aplicativo), `mfa_last_used_step` (novo, replay; previsto no AUTH-04), `mfa_enabled_at` (já existe = confirmado).
- `recovery_codes`: hash do código (`code_hash`, já existe) com `UNIQUE (user_id, code_hash)`; consumo por `DELETE …
RETURNING`.
- `mfa_failures` (nova): `user_id`, `failed_at`, para contar falhas na janela com uma instrução atômica.

Tabelas vazias hoje (nenhum login existiu), então a migration não precisa migrar dados; o `down()` restaura o formato
anterior.

## R6. Filtro de listagem pela mesma regra da política

**Decision**: para cada recurso com escopo, uma função de escopo única devolve as condições (atribuição, perfil,
conflito de interesse) em dois formatos derivados da mesma definição: um predicado para a política (`authorize()` no
registro) e uma condição de consulta para o repositório (`WHERE`). No protótipo, um teste gera combinações de perfis,
atribuições e bloqueios e confere que o conjunto listado é exatamente o conjunto em que a política permite leitura.

**Rationale**: atende FR-018 e o princípio IV sem duplicar regra à mão em dois lugares.

## R7. Auditoria de autenticação e negação

**Decision**: um assinante de `AuthenticationEvents.events$` e de `AuthorizationEvents` grava na trilha pelo
`AuditService.record()` (catálogo da feature 003, com ações novas `AUTH_SIGNED_IN`, `AUTH_SIGNED_OUT`,
`AUTH_MFA_FAILED`, `AUTH_SESSION_REVOKED` e `ACCESS_DENIED`), dentro do contexto da requisição (D46), sem senha,
código, token ou id de sessão na metadata. No protótipo, só `ACCESS_DENIED` e `AUTH_SIGNED_IN` são provados; as
demais ações entram com o AUTH-01 em diante.

## R8. Onde fica o código (FR-023)

**Decision**:

- **Definitivo, em `src/`**: `src/infra/auth/stores/pg-session.store.ts`, `pg-mfa.store.ts`,
  `src/infra/auth/session-auth-identity.ts`, a configuração do `AuthenticationModule`/`AuthorizationModule` em
  `src/infra/auth/auth-infra.module.ts`, a migration `AuthStores` e as entidades ajustadas.
- **Teste de contrato, fora de `src/`**: `test/contract/auth/` com um módulo de exemplo só de teste (rotas de login com
  senha e MFA, rota protegida, políticas e repositório de exemplo) e as suítes que provam US2, US3 e US4; mais a suíte
  `authenticationStoreContract()` contra os stores Postgres.
- As rotas reais de login (`/api/admin/v1/auth/*`) e as políticas reais ficam para 04-auth e 05-access-control.

## R9. Datas e relógio nos testes

**Decision**: `SessionService` e `MfaService` recebem `now` de um relógio injetável nos testes (opção `now` do
pacote); as expirações de 15 min e 8 h e a janela do TOTP são testadas avançando o relógio, sem esperar tempo real
(premissa da spec).
