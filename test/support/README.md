# Harness de testes de integração

Tudo o que um teste `*.e2e-spec.ts` precisa para subir a API como em produção e provar as regras de privacidade.

## Pré-requisitos

```bash
docker compose up -d   # Postgres, Vault (com KEKs e AppRole de dev), Redis, S3, Mailpit
```

O `.env` local (copiado de `.env.example`) precisa de `TEST_ADMIN_DATABASE_URL`, `DATABASE_URL` e
`DATABASE_MIGRATOR_URL`. No CI, essas variáveis vêm do job `e2e`.

## Peças

| Arquivo            | O que faz                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `global-setup.ts`  | Roda uma vez: recria `canal_test_template` com as migrations (carregadas pelo Vite, sem `dist/`)                                                             |
| `test-database.ts` | Clona um banco por suíte a partir do modelo e o descarta no fim. `audit_logs` não aceita DELETE nem TRUNCATE, então não há limpeza de tabelas                |
| `test-env.ts`      | Padrões dos serviços locais. Força `NODE_ENV=test` e `PASSWORD_HASH_LOG_N=10`                                                                                |
| `test-app.ts`      | `createTestApp({ imports })`: AppModule + `setupApp` + banco da suíte + captura de log. Devolve `{ app, logs, database, close }`                             |
| `log-capture.ts`   | `logs.text()`, `logs.lines()` e `logs.forRequest(requestId)`                                                                                                 |
| `factories.ts`     | `createUser({ roles })`, `createCategory()`, `createEncryptedReport(ds, cryptoDeps(app), content)`, que cifra pelo `CryptoModule` (mesma camada dos módulos) |
| `fixtures/`        | Módulos com rotas só de teste (erros, validação, rotas públicas e administrativas, serviço de chaves, paginação)                                             |

## Exemplo: provar que um relato não vai para o log

```ts
import request from 'supertest';
import { createTestApp, type TestApp } from '../support/test-app.js';

describe('Minha rota (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp({ imports: [MeuModuloDeFixture] })));
  afterAll(() => t.close());

  it('não loga o relato', async () => {
    await request(t.app.getHttpServer()).post('/api/public/v1/...').send({ description: 'XQZ' }).expect(201);
    expect(t.logs.text()).not.toContain('XQZ');
  });
});
```

## Regras

- Um app por arquivo de teste (`beforeAll`/`afterAll`). O Vitest isola cada arquivo, e é isso que permite ao
  `createTestApp` apontar o AppModule para o banco da suíte.
- Em testes de "não vazou", use também textos **curtos** (ex.: `XQZ`). Mensagens de bibliotecas costumam truncar a
  entrada, e um texto longo pode esconder um vazamento parcial.
- Variáveis de ambiente específicas de uma suíte (ex.: um `VAULT_ADDR` inacessível) vão no `beforeAll`, antes do
  `createTestApp`.
