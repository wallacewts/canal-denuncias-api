# 0053. Autenticação e autorização com os pacotes oficiais do Nest 12

- **Status:** decidido (D53 e D54)
- **Data:** 2026-11-28
- **Feature:** `specs/004-auth-library-decision` (AUTH-00 e ACL-00)

## Contexto

A área administrativa (equipe interna) precisa de login com senha e segundo fator obrigatório, sessão segura e
controle de acesso negado por padrão, com escopo aplicado na consulta (constituição, princípios III e IV). O registro
original previa `passport`, `passport-jwt`, `argon2`, `otplib` (D03) e CASL (D10). O Nest 12 oferece
`@nestjs/authentication` e `@nestjs/authorization`. O hash de senha já usava o primeiro (D32). A decisão precisava vir
antes de qualquer código de login ou permissão (etapa 3 do backlog), com prova.

## Decisão

**Autenticação (D53):** `@nestjs/authentication`, versão exata 0.1.8.

- Sessão por cookie no servidor (`__Host-sid`, `HttpOnly`, `Secure`, `SameSite=Strict`): 15 min sem uso, 8 h no máximo,
  id trocado no login e na verificação do segundo fator, sair de todos os lugares encerra todas as sessões do usuário.
- MFA TOTP obrigatório: toda rota `@AdminApi` exige sessão com segundo fator verificado.
- **Sem tokens de acesso nem de renovação.** O usuário escolheu primeiro manter a renovação (Q-P2 = B); o desenho a
  colocou num canal separado, só para clientes sem navegador, que hoje ninguém usa, e ele decidiu tirá-lo (Q-P2 revista
  para A). Um canal de tokens pode ser criado no futuro, **por decisão própria**, se surgir um cliente que não seja
  navegador. Ponto de partida: emissão só a partir de sessão verificada com MFA, entrega única no corpo, nenhuma rota do
  navegador aceitando token portador, família com teto de 8 h, `RefreshTokenStore` em Postgres e segredo de assinatura
  fora do repositório (research R3).
- Stores definitivos em Postgres (`src/infra/auth/stores/`): `PgSessionStore` e `PgMfaStore`, aprovados no contrato
  oficial do pacote (`authenticationStoreContract()`, inclusive concorrência). Nada fica em memória
  (`allowInMemoryStorage: false`).
- O segredo TOTP é selado pelo `AppSecretService` (Vault, `app-kek`, preso ao usuário); a cifragem local do pacote
  fica desligada (`mfa.encryption: false`), para não haver chave fora do Vault.

**Autorização (D54):** `@nestjs/authorization`, versão exata 0.1.4. Políticas como providers, `@Can()` nas rotas,
`authorize()` nos serviços, negação por padrão (rota sem regra = 403, listada na inicialização). Substitui o CASL da
D10. As listagens são filtradas na consulta por uma função de escopo única, da qual a política também deriva a regra.

## Tabela requisito × opção

Legenda: ✅ atende sozinho · 🔧 atende com extensão própria (sem código de criptografia ou protocolo) · ✍️ exige código
próprio de segurança.

| Requisito                                                            | Pacotes oficiais                                                                   | Passport + express-session + otplib + CASL | Evidência                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| FR-005 segundo fator obrigatório                                     | ✅ (sessão `pending` não autentica; `@Authenticate({ mfa: true })` no `@AdminApi`) | ✍️                                         | `test/contract/auth/sign-in-mfa.e2e-spec.ts`                                |
| FR-006 mesma resposta e tempo para e-mail inexistente e senha errada | ✅ (`PasswordHasher.verify` com hash fictício)                                     | ✍️                                         | idem: diferença medida de 0,0 a 0,1 ms sobre ~28,7 ms (logN 14, 20 de cada) |
| FR-007 cookie seguro, token fora do corpo e da URL                   | ✅                                                                                 | ✅                                         | idem                                                                        |
| FR-008 15 min sem uso e 8 h no máximo                                | ✅ (`idleTtl`, `absoluteTtl`)                                                      | ✍️ (absoluta)                              | `test/contract/auth/session-expiry.e2e-spec.ts` (relógio controlado)        |
| FR-009 sessões e MFA no Postgres; produção recusa memória            | 🔧 (stores)                                                                        | 🔧 (connect-pg-simple; sem recusa)         | `store-contract`, `session-expiry`                                          |
| FR-010 id trocado no login e no MFA; encerrar todas as sessões       | ✅                                                                                 | ✍️                                         | `sign-in-mfa`, `session-expiry`                                             |
| FR-011 código TOTP de uso único                                      | ✅ (`claimTotpStep`)                                                               | ✍️                                         | `sign-in-mfa`, `store-contract`                                             |
| FR-012 identidade recarregada a cada requisição                      | ✅ (`validate()` com o usuário lido na mesma consulta da sessão)                   | ✍️                                         | `session-expiry` (desativado), `authorization` (perfil retirado)            |
| FR-013 hash atual aceito sem migração                                | ✅ (D32)                                                                           | n/a                                        | `create-admin` usa o mesmo `PasswordHasher`                                 |
| FR-014 sessão alimenta a `AUTH_IDENTITY`                             | 🔧 (`SessionAuthIdentity`)                                                         | 🔧                                         | todas as suítes `test/contract/auth/`                                       |
| FR-015 eventos de autenticação na trilha, sem segredo                | ✅ (`AuthenticationEvents`) + 🔧 (assinante)                                       | ✍️                                         | `sign-in-mfa`, `session-expiry`                                             |
| FR-016 negação por padrão, listada na inicialização                  | ✅                                                                                 | ✍️ (guard próprio)                         | `test/contract/auth/authorization.e2e-spec.ts`                              |
| FR-017 regras por perfil e por registro, com serviços                | ✅                                                                                 | ✅                                         | idem                                                                        |
| FR-018 filtro de listagem na consulta                                | 🔧 (função de escopo única)                                                        | 🔧 (sem adaptador oficial TypeORM)         | `test/contract/auth/example/report-scope.e2e-spec.ts`                       |
| FR-019 DPO lê sem tratar; ninguém altera os próprios perfis          | ✅ (políticas)                                                                     | ✅                                         | `authorization`                                                             |
| FR-020 negação gravada como `ACCESS_DENIED`                          | ✅ (`AuthorizationEvents`) + 🔧 (assinante)                                        | ✍️                                         | `authorization`                                                             |
| FR-021 401 e 403 distinguíveis                                       | ✅                                                                                 | ✅                                         | `authorization`                                                             |

## Consequências

- **Fica mais fácil:** nenhuma linha de criptografia, protocolo TOTP, comparação de senha ou geração de token escrita
  pelo projeto. As extensões próprias são persistência (`PgSessionStore`, `PgMfaStore`), a ponte com a porta de
  identidade (`SessionAuthIdentity`), o assinante de auditoria e a função de escopo de cada recurso.
- **Riscos aceitos:** os pacotes estão em 0.1.x. Mitigação: versões exatas, a suíte de contrato do próprio pacote
  contra os stores Postgres e as suítes de `test/contract/auth/` reexecutadas a cada atualização, e o ponto de saída
  pela porta `AUTH_IDENTITY` (D47): trocar de biblioteca troca o adaptador e os stores, não a área administrativa.
- **Impacto em decisões anteriores:** D03 (hash) já estava alterada pela D32; D10 alterada pela D54 (CASL → pacote
  oficial).
- **Modelo de dados:** migration `AuthStores` — `sessions` com chave = hash do cookie (saem `refresh_token_hash`,
  `family_id`, `revoked_at`), colunas `mfa_pending_secret_enc` e `mfa_last_used_step` em `users`, `recovery_codes`
  consumidos por DELETE e a tabela `mfa_failures`.
- **A acompanhar:** os guards globais rodam na ordem em que os módulos são encontrados; o guard da área administrativa
  fica num módulo importado depois dos dois pacotes (`AdminAreaGuardModule`). Uma negação feita pelo guard acontece
  antes do contexto da auditoria: o `ACCESS_DENIED` dela sai com o usuário do evento e sem IP.

## Mapeamento da matriz do ACL-01

Onde cada linha da matriz (`docs/tarefas/05-access-control.md`) é aplicada. **Rota** = `@Can(Política, 'habilidade')`
no handler (o guard nega antes de chegar ao serviço). **Serviço** = `authorize()` (ou `can()`) depois de carregar o
registro, porque a regra depende dele. **Consulta** = função de escopo no `WHERE`, da qual a política deriva a mesma
regra (padrão provado em `test/contract/auth/example/report-scope.ts`). Bloqueio por conflito
(`report_access_blocks`) nega sempre, para qualquer perfil, nas três camadas.

| Habilidade                                        | Rota                                | Serviço                                              | Consulta                                              |
| ------------------------------------------------- | ----------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Gerenciar usuários e categorias                   | ADMIN                               | perfis: ninguém altera os próprios (D21), com o id   | —                                                     |
| Alterar SLA                                       | ADMIN                               | —                                                    | —                                                     |
| Alterar retenção e legal hold                     | DPO                                 | bloqueio por conflito, quando for de uma denúncia    | —                                                     |
| Listar todas as denúncias                         | Gestor, DPO, Analista (mesma rota)  | —                                                    | Gestor e DPO: todas menos as bloqueadas               |
| Listar denúncias atribuídas a si                  | idem                                | —                                                    | Analista: `assigned_to_id` = ele, menos as bloqueadas |
| Ver conteúdo da denúncia (somente leitura)        | equipe com sessão (`@Can.Anyone()`) | `read`: Gestor, DPO, Analista se atribuída; 404 (\*) | —                                                     |
| Triar, atribuir, priorizar, bloquear por conflito | Gestor                              | bloqueio por conflito                                | —                                                     |
| Mudar status, mensagens e notas                   | equipe com sessão                   | `treat`: Gestor, Analista se atribuída; DPO nunca    | —                                                     |
| Pedir revelação de identidade                     | equipe com sessão                   | igual a `treat`                                      | —                                                     |
| Aprovar ou rejeitar revelação                     | DPO                                 | bloqueio por conflito                                | —                                                     |
| Ver trilha de auditoria                           | AUDITOR (hoje checado no handler)   | —                                                    | —                                                     |
| Ver indicadores                                   | Gestor, DPO, AUDITOR                | —                                                    | só agregados, sem conteúdo                            |

(\*) Registro de outro analista responde 404, não 403 (ACL-02): o serviço usa `can()`, responde 404 e grava o
`ACCESS_DENIED` com `AuditService.record()` (ACL-04). ADMIN e AUDITOR nunca passam no `read`. Denúncia expurgada
responde 410 antes da política.

## O que já existe e o que cada tarefa seguinte constrói

Para quem especifica as próximas features (inclusive o login do backoffice no front).

**Já existe (definitivo, em `src/`):**

- **Pacotes configurados** em `src/infra/auth/auth-infra.module.ts`: sessão 15 min sem uso / 8 h no máximo, cookie
  `__Host-sid` (`HttpOnly`, `Secure`, `SameSite=Strict`, caminho `/`), MFA TOTP (janela ±1 passo, 5 falhas em 15 min
  bloqueiam o MFA, 10 códigos de recuperação, cadastro pendente expira em 10 min), relógio injetável (`AUTH_CLOCK`).
- **Stores Postgres**: `PgSessionStore` (sessões, lista e encerramento das sessões de um usuário) e `PgMfaStore`
  (segredo TOTP selado pelo Vault, último passo usado, códigos de recuperação consumidos por DELETE, falhas de MFA).
- **Identidade**: `StaffSessionProvider` (usuário e perfis relidos do banco a cada requisição; só `ACTIVE` passa) e a
  ponte `SessionAuthIdentity` na porta `AUTH_IDENTITY` (D47), que a auditoria e o `AdminIdentityGuard` usam.
- **Guards globais**, nesta ordem: autenticação do pacote, autorização do pacote, `AdminIdentityGuard`. `@PublicApi`
  abre a rota (sem cookie, sem identidade); `@AdminApi` exige sessão com MFA verificado; rota administrativa sem
  `@Can()`/`@Can.Anyone()` responde 403 e aparece no log da inicialização.
- **`OpenAdminRoute()`** (`src/common/http/route-decorators.ts`): abre uma rota administrativa antes da sessão
  completa (login e desafio MFA). A auditoria dela sai como equipe sem usuário, com IP.
- **Eventos de auditoria** (`AuthAuditSubscriber`): `sign-in` com senha e sem MFA pendente e `mfa-verified` →
  `AUTH_SIGNED_IN`; `mfa-failed` → `AUTH_MFA_FAILED` (`locked`); `sign-out` → `AUTH_SIGNED_OUT`, ou
  `AUTH_SESSION_REVOKED` (`scope: all`) quando é "sair de todos os lugares"; negação da autorização →
  `ACCESS_DENIED` (`policy`, `ability`).

**Só de teste (`test/contract/auth/example/`, nunca importado por `src/`):** as rotas `example-auth` (sign-in, mfa,
me, sign-out, sign-out-everywhere), a `ExamplePolicy` e a função de escopo de exemplo. Servem de referência de
implementação, não de contrato público.

**Fluxo que o backoffice vai usar** (rotas reais criadas no AUTH-01 a AUTH-04; comportamento provado nas rotas de
exemplo): `POST sign-in` com e-mail e senha → 200 com `mfaRequired` e cookie de sessão pendente (401 genérico para
qualquer falha) → `POST` do desafio MFA com o código → 200 e cookie **novo** (o id muda) → rotas administrativas com
o cookie. Sem sessão, sessão expirada ou usuário desativado: 401. Logado sem permissão: 403. `sign-out`: 204 e cookie
apagado. O front envia credenciais (`credentials: 'include'`), não guarda nada em `localStorage` e não recebe token
nenhum. O cookie é `Secure`: em desenvolvimento, só funciona em `localhost` ou HTTPS. O formato das respostas reais
(código da próxima etapa, horários de expiração, permissões efetivas no `GET /me`) está nas premissas de contrato do
`docs/tarefas/04-auth.md` e no USERS-07, propostas pelo front e compatíveis com esta decisão.

**Falta construir:**

| Tarefa      | O que constrói sobre o que existe                                                                                                                                                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-01     | Rota real de login (`OpenAdminRoute`), serviço de credenciais (mesmo caminho de hash para e-mail inexistente), status `BLOCKED`/`DISABLED` com a resposta genérica, bloqueio progressivo de login (`failed_login_count`, `locked_until`) e `AUTH_LOGIN_FAILED` gravado pelo serviço (o pacote não emite evento de falha de senha) |
| AUTH-02     | Rotas `sign-out` e de sessões (`listUserSessions`/`deleteUserSessions` já existem no store)                                                                                                                                                                                                                                       |
| AUTH-03     | Rotas de cadastro do MFA sobre `MfaService.enroll`/`confirm`; mapear `mfa-enabled` → `AUTH_MFA_ENROLLED` no assinante; restringir a sessão sem MFA às rotas de cadastro e troca de senha                                                                                                                                          |
| AUTH-04     | Rota do desafio sobre `SignInService.completeMfa`; mapear `mfa-verified` com `recovery-code` → `AUTH_RECOVERY_CODE_USED`; somar as falhas de MFA ao bloqueio progressivo do login                                                                                                                                                 |
| AUTH-05     | Troca de senha com `PasswordHasher`, nova sessão e encerramento das outras (`deleteUserSessions`)                                                                                                                                                                                                                                 |
| AUTH-06     | Só o teste do fluxo inteiro com as rotas reais; o resto já existe                                                                                                                                                                                                                                                                 |
| AUTH-07     | CSRF (`app.enableCsrfProtection`, origens confiáveis) e CORS com credenciais só para o backoffice                                                                                                                                                                                                                                 |
| AUTH-08     | Rate limit em `sign-in` e no desafio                                                                                                                                                                                                                                                                                              |
| USERS-04/05 | Status e perfis já valem na requisição seguinte; ao bloquear/desativar, encerrar as sessões                                                                                                                                                                                                                                       |
| USERS-06    | Reset do MFA com `MfaService.disable` e encerramento das sessões do usuário                                                                                                                                                                                                                                                       |
| ACL-01 a 05 | Políticas reais em `src/modules/access-control/` conforme o mapeamento acima                                                                                                                                                                                                                                                      |

## Alternativas consideradas

- **Passport + express-session + connect-pg-simple + otplib + CASL:** maduros, mas exigiriam escrever as partes mais
  delicadas (expiração absoluta, replay e bloqueio do TOTP, códigos de recuperação, tempo constante, negação por padrão,
  eventos de negação). `passport-local` não tem versão nova desde 2023; o CASL não tem adaptador oficial para TypeORM.
- **Cifragem local do segredo TOTP pelo pacote:** exigiria chave estática em variável de ambiente, contra a D08 e o
  princípio III.
- **Renovação por tokens:** ver a decisão acima (Q-P2 revista).
