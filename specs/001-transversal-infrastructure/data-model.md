# Data Model: Infraestrutura transversal da API

**Feature**: [spec.md](./spec.md) | **Plano**: [plan.md](./plan.md)

Esta feature **não cria tabelas nem migrations**. Ela usa as entidades que já existem e define estruturas de dados
em trânsito (erro, página, job, chave de dados).

## Entidades persistidas usadas

| Entidade                  | Uso nesta feature                                                                                | Regras                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User` (`users`)          | O `create-admin` insere o primeiro administrador pelo `UsersRepository` (USERS-01)               | E-mail único pela constraint (`23505` → 409). `password_hash` em formato `$scrypt$ln=..,r=..,p=..$salt$hash` (D32) e só lido por `findCredentialsByEmail`. `mfa_enabled_at` nulo obriga o cadastro do MFA no primeiro login. `status = ACTIVE` |
| `UserRole` (`user_roles`) | Perfil `ADMIN` do primeiro administrador                                                         | `granted_by_id` nulo (concedido pelo sistema)                                                                                                                                                                                                  |
| `AuditLog` (`audit_logs`) | `USER_CREATED` com `actor_type = SYSTEM` pelo `AuditService.record()` (núcleo da AUDIT-02, Q-P2) | Só `INSERT`. `prev_hash` do último registro, ou 32 bytes zerados na gênese. `hash = sha256(prev_hash ‖ campos canônicos)`. `occurred_at` definido pela aplicação. `metadata` sem dado pessoal: `{ "roles": ["ADMIN"], "forced": false }`       |

Regra de "já existe ADMIN ativo": existe `user_roles.role = ADMIN` com `users.status = ACTIVE`. A contagem e a
inserção rodam na mesma transação, com `pg_advisory_xact_lock` próprio do comando, para que duas execuções
simultâneas não criem dois administradores.

## Estruturas em trânsito

### Erro da API (TRV-01)

| Campo        | Tipo           | Regra                                                                                                    |
| ------------ | -------------- | -------------------------------------------------------------------------------------------------------- |
| `statusCode` | inteiro        | Código HTTP                                                                                              |
| `error`      | texto          | Nome curto do código (`Bad Request`, `Conflict`...)                                                      |
| `message`    | texto ou lista | Mensagem segura. No 500, sempre genérica. Na validação, a lista de `{ path, code, message }` sem valores |
| `requestId`  | UUID           | O mesmo `req.id` do log                                                                                  |

Mapeamento: `23505` → 409; `23503` → 409 (escrita) ou 404 (referência inexistente na leitura); erro de validação →
400; `KeyServiceUnavailableError` → 503; qualquer outro → 500.

### Página (TRV-08)

| Campo        | Tipo            | Regra                                                                            |
| ------------ | --------------- | -------------------------------------------------------------------------------- |
| `items`      | lista           | No máximo `limit` itens                                                          |
| `nextCursor` | texto ou `null` | Codificação opaca (base64url) do UUID v7 do último item. `null` na última página |

Entrada: `limit` de 1 a 100 (padrão 20) e `after` opcional. Um cursor inválido gera 400. A consulta usa
`WHERE id > :after ORDER BY id LIMIT :limit + 1`.

### Job (TRV-05)

| Campo        | Regra                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `name`       | Nome da tarefa                                                                                                           |
| `data`       | Objeto validado por schema zod, aceitando só UUIDs e códigos de enum. Nada de texto livre                                |
| `opts.jobId` | Derivado da tarefa (ex.: `notify-new-report:<reportId>`)                                                                 |
| Padrões      | `attempts: 5`, backoff exponencial a partir de 5 s, `removeOnComplete: { count: 1000 }`, `removeOnFail: { count: 5000 }` |

### Chave de dados (TRV-04)

| Campo       | Regra                                                                       |
| ----------- | --------------------------------------------------------------------------- |
| `plaintext` | `Buffer` de 32 bytes, só em memória. O chamador zera o buffer depois do uso |
| `wrapped`   | Texto `vault:vN:...` para guardar (ex.: `reports.wrapped_dek`)              |
| `kek`       | Só `report-kek` ou `app-kek` (allowlist). `identity-kek` é recusada (D24)   |

### Configuração (TRV-03)

Ver [contracts/environment.md](./contracts/environment.md).
