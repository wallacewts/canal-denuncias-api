# Contrato: integração dos pacotes com a API

## Configuração (definitiva, `src/infra/auth/auth-infra.module.ts`)

```ts
AuthenticationModule.forRootAsync({
  session: { idleTtl: '15m', absoluteTtl: '8h', touchInterval: '1m', cookie: { sameSite: 'strict' } },
  mfa: {
    encryption: false,
    issuer: 'Canal de Denúncias',
    window: 1,
    maxAttempts: 5,
    lockoutWindow: '15m',
    recoveryCodes: 10,
    pendingTtl: '10m',
  },
  // sem accessToken: só sessão por cookie, sem TokenService nem renovação (R3)
  allowInMemoryStorage: false,
});
AuthorizationModule.forRoot(); // depois do AuthenticationModule (ordem dos guards globais)
```

- `encryption: false` só porque o `PgMfaStore` sela o segredo com o `AppSecretService`; um teste confere que o valor
  gravado em `users.mfa_secret_enc` nunca é o segredo base32 em claro.
- `allowInMemoryStorage: false` em todos os ambientes, inclusive testes (stores Postgres sempre).
- Em desenvolvimento HTTP fora de `localhost`, `cookie.secure: false` só por variável de ambiente de dev; os testes
  conferem os atributos de produção.

## Regras de rota

| Situação                                                              | Resultado                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Rota `@PublicApi`                                                     | compõe `@Public()`: o guard de autenticação não lê nem emite cookie; sem `request.user` |
| `/health`, `/ready`, Swagger                                          | `@Public()`                                                                             |
| Rota `@AdminApi` sem sessão, ou com sessão `mfa: pending`             | 401 (guard global do pacote e `AdminIdentityGuard`)                                     |
| Rota `@AdminApi` com sessão verificada e sem `@Can()`/`@Can.Anyone()` | 403, e a rota aparece na lista da inicialização                                         |
| Rota `@AdminApi` com `@Can(Policy, 'habilidade')`                     | 200 se a política permitir, 403 caso contrário                                          |
| Rota `@AdminApi` comum chamada com `Authorization: Bearer`            | 401: não há provider de token portador; só o cookie de sessão autentica                 |

## Porta de identidade (D47)

`SessionAuthIdentity implements AuthIdentity`: `resolve(request)` devolve `{ userId, roles }` a partir do
`AuthenticationContext` (usuário carregado do banco no `validate()` do `StaffSessionProvider`), ou `null`. Substitui
o `NoAuthIdentity` no `AUTH_IDENTITY`. A trilha (D46) continua lendo o ator equipe por essa porta.

## Auditoria

| Evento do pacote                                       | Ação da trilha                                 | Metadata                                         |
| ------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------ |
| `AuthenticationEvents` `sign-in`                       | `AUTH_SIGNED_IN`                               | `{ method: 'password' }`                         |
| `AuthenticationEvents` `mfa-failed`                    | `AUTH_MFA_FAILED`                              | `{}`                                             |
| `AuthenticationEvents` `sign-out`                      | `AUTH_SIGNED_OUT`                              | `{}`                                             |
| `revokeAll`/`signOutEverywhere` (sem evento do pacote) | `AUTH_SESSION_REVOKED`, gravado por quem chama | `{ count }`                                      |
| `AuthorizationEvents` `denied`                         | `ACCESS_DENIED`                                | `{ policy, ability }` (códigos, sem texto livre) |

Nunca: senha, código TOTP, código de recuperação, token, id/hash de sessão.
