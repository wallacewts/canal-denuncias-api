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

Feito na US4 (T031), depois do encaixe com o que já existe.

## Alternativas consideradas

- **Passport + express-session + connect-pg-simple + otplib + CASL:** maduros, mas exigiriam escrever as partes mais
  delicadas (expiração absoluta, replay e bloqueio do TOTP, códigos de recuperação, tempo constante, negação por padrão,
  eventos de negação). `passport-local` não tem versão nova desde 2023; o CASL não tem adaptador oficial para TypeORM.
- **Cifragem local do segredo TOTP pelo pacote:** exigiria chave estática em variável de ambiente, contra a D08 e o
  princípio III.
- **Renovação por tokens:** ver a decisão acima (Q-P2 revista).
