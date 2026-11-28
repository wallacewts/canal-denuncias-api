# Contrato: rotas de login, MFA, senha e sessões

Prefixo `/api/admin/v1`. Sessão só pelo cookie `__Host-sid` (`HttpOnly`, `Secure`, `SameSite=Strict`); nenhum token no
corpo ou na URL. Erros no formato `ApiError` com `code` e `details` opcionais (D56). Escrita de outra origem: 403
(proteção por origem). **401 significa só sessão ausente ou expirada** (Q1), exceto no `sign-in`, onde é a falha
genérica de credencial.

Formato igual ao do front (`canal-denuncias-web/specs/004-backoffice-sign-in/contracts/auth-api.md`), com as decisões
Q1 e Q2 da feature 006 aplicadas.

## Tipos

```text
NextStep      = 'MFA_REQUIRED' | 'MFA_ENROLLMENT_REQUIRED' | 'PASSWORD_CHANGE_REQUIRED' | 'DONE'
SessionExpiry = { idleExpiresAt: string (ISO 8601 UTC), absoluteExpiresAt: string (ISO 8601 UTC) }
StepResponse  = { nextStep: NextStep } & SessionExpiry
Enrollment    = { otpauthUri: string, qrCodeDataUri: 'data:image/png;base64,…', secret: string }
Confirmation  = { recoveryCodes: string[10] } & StepResponse
OwnSession    = { id: string, createdAt: string, lastActiveAt: string, ip: string | null,
                  userAgent: string | null, current: boolean }
```

## Rotas

| Método e caminho                         | Acesso                                      | Corpo                              | Sucesso                               | Erros                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------- | ---------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/sign-in`                     | aberta                                      | `{ email, password }`              | 200 `StepResponse` + cookie           | 401 genérico (qualquer falha, inclusive bloqueio); 429 limite (`Retry-After`); 400 corpo                                                                                                |
| `POST /auth/mfa/challenge`               | sessão `MFA_REQUIRED`                       | `{ code }` ou `{ recoveryCode }`   | 200 `StepResponse` + cookie novo      | 422 `MFA_CODE_INVALID`; 423 `MFA_LOCKED`; 429 limite; 401 sem sessão pendente; 400 corpo                                                                                                |
| `POST /auth/mfa/enrollment`              | sessão `MFA_ENROLLMENT_REQUIRED`            | —                                  | 200 `Enrollment`                      | 403 `STEP_NOT_ALLOWED` fora da etapa; 401 sem sessão                                                                                                                                    |
| `POST /auth/mfa/enrollment/confirmation` | sessão `MFA_ENROLLMENT_REQUIRED`            | `{ code }`                         | 200 `Confirmation` + cookie novo      | 422 `MFA_CODE_INVALID`; 403 `STEP_NOT_ALLOWED`; 401; 400 corpo                                                                                                                          |
| `PUT /me/password`                       | sessão `PASSWORD_CHANGE_REQUIRED` ou `DONE` | `{ currentPassword, newPassword }` | 200 `StepResponse` + cookie novo      | 422 `CURRENT_PASSWORD_INVALID`, `PASSWORD_TOO_SHORT`, `PASSWORD_COMMON`, `PASSWORD_SAME_AS_CURRENT`; 429 no 5º erro de senha atual (sessão encerrada); 403 `STEP_NOT_ALLOWED`; 401; 400 |
| `POST /auth/sign-out`                    | qualquer sessão (inclusive pendente)        | —                                  | 204, cookie apagado                   | —                                                                                                                                                                                       |
| `GET /me/sessions`                       | sessão `DONE`                               | —                                  | 200 `OwnSession[]`                    | 401                                                                                                                                                                                     |
| `DELETE /me/sessions/:id`                | sessão `DONE`                               | —                                  | 204                                   | 404 (inexistente ou de outra pessoa); 401                                                                                                                                               |
| `DELETE /me/sessions`                    | sessão `DONE`                               | —                                  | 204, todas encerradas, cookie apagado | 401                                                                                                                                                                                     |
| `GET /me`                                | sessão `DONE` (feature 005)                 | —                                  | 200 `CurrentUser`                     | 401                                                                                                                                                                                     |

Regras:

- Ordem das etapas (Q2): sem autenticador, `PASSWORD_CHANGE_REQUIRED` (se obrigatória) e depois
  `MFA_ENROLLMENT_REQUIRED`; com autenticador, `MFA_REQUIRED` e depois `PASSWORD_CHANGE_REQUIRED` (se obrigatória).
- Sessão verificada com troca obrigatória pendente: as demais rotas administrativas respondem **403
  `PASSWORD_CHANGE_REQUIRED`**; continuam liberadas `PUT /me/password`, `POST /auth/sign-out` e `GET /me` (com
  `passwordChangeRequired: true`) (R11 = A).
- Limites (padrões, configuráveis no servidor): bloqueio temporário de 15 min após 5 falhas, dobrando a cada série até
  24 h; 20 tentativas por minuto por IP e 10 a cada 15 min por conta em `sign-in` e `mfa/challenge`.
- `recoveryCodes` só nesta resposta; `secret` e `qrCodeDataUri` só no cadastro; nada disso em log ou trilha.
- `idleExpiresAt` pode vir até 1 min antes do real (nunca depois).
- `OwnSession.id` é um identificador público derivado (HMAC com chave de finalidade, R4a), nunca o valor do cookie.
- Rota de etapa chamada fora da etapa: 403 `STEP_NOT_ALLOWED` (I1); 401 continua só para sessão ausente ou expirada.
