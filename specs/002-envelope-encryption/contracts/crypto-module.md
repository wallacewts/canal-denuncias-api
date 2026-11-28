# Contrato: interface do CryptoModule

O que o `CryptoModule` exporta para os módulos reports, messages, case-management, attachments e auth. Nenhum módulo
fala com o Vault para cifrar conteúdo por outro caminho.

```ts
/** Colunas cifradas conhecidas (lista fechada, encryption-context.ts). */
type EncryptedColumn =
  | 'reports.content_enc'
  | 'messages.body_enc'
  | 'internal_notes.body_enc'
  | 'report_status_history.justification_enc'
  | 'report_access_blocks.reason_enc'
  | 'identity_reveal_requests.justification_enc'
  | 'attachments.original_name_enc'
  | 'attachments.object'
  | 'users.mfa_secret_enc';

/** Contexto já validado (ids UUID). Não é guardado; é recalculado na abertura. */
interface EncryptionContext {
  readonly column: EncryptedColumn;
  readonly aad: Buffer; // UTF-8 de "<tabela>.<campo>:<id>[.<id2>]"
}

function encryptionContext(column: EncryptedColumn, ...ids: [string, ...string[]]): EncryptionContext;

function newRecordId(): string; // UUID v7

class DataKeyService {
  /** Gera a DEK da nova denúncia, executa fn com ela em claro e devolve o resultado e a versão protegida. */
  createReportKey<T>(fn: (dek: Buffer) => T | Promise<T>): Promise<{ result: T; wrapped: string }>;
  /** Abre a DEK guardada, executa fn e zera a DEK no finally. wrapped nulo => ContentUnavailableError. */
  withReportKey<T>(wrapped: string | null, fn: (dek: Buffer) => T | Promise<T>): Promise<T>;
}

class RecordCipher {
  sealJson(dek: Buffer, ctx: EncryptionContext, value: { v: number }): Buffer;
  openJson<T>(dek: Buffer, ctx: EncryptionContext, schemas: Record<number, StandardSchema<T>>): T;
  sealText(dek: Buffer, ctx: EncryptionContext, text: string): Buffer;
  openText(dek: Buffer, ctx: EncryptionContext): string;
}

class AppSecretService {
  seal(ctx: EncryptionContext, secret: Buffer): Promise<string>; // "vault:vN:..."
  open(ctx: EncryptionContext, value: string): Promise<Buffer>; // quem chama zera o buffer
}

// Streaming (stream-cipher.ts), usado pela feature attachments
function createEncryptStream(
  dek: Buffer,
  ctx: EncryptionContext,
): {
  stream: Transform;
  ciphertextSha256(): string; // disponível depois do fim do stream
};
function createDecryptStream(dek: Buffer, ctx: EncryptionContext): Transform;
```

## Regras de uso

| Regra                                                                             | Origem      |
| --------------------------------------------------------------------------------- | ----------- |
| Chamar `createReportKey`/`withReportKey` **antes** de abrir a transação do banco  | FR-009      |
| A DEK recebida em `fn` não pode ser guardada fora da função                       | FR-007      |
| O id do registro é gerado com `newRecordId()` antes da cifragem e usado no insert | FR-014      |
| `openJson` sempre recebe o mapa de schemas por versão                             | FR-011, 013 |
| A DEK em claro só existe para a `report-kek`; não há método para a `identity-kek` | FR-010, D24 |

## Erros (crypto.errors.ts)

| Erro                               | Quando                                                 | HTTP (filtro global) |
| ---------------------------------- | ------------------------------------------------------ | -------------------- |
| `DecryptionFailedError`            | contexto errado, dado ou tag adulterados, chave errada | 500 genérico         |
| `UnsupportedFormatError`           | versão desconhecida ou tamanho impossível              | 500 genérico         |
| `ContentSchemaError`               | JSON aberto fora do schema da versão                   | 500 genérico         |
| `ContentUnavailableError`          | `wrapped_dek` nulo (expurgado)                         | decidido pelo módulo |
| `KeyServiceUnavailableError` (001) | Vault fora do ar                                       | 503                  |

Todos têm mensagem fixa, sem `cause` e sem propriedade que contenha texto em claro, chave ou valor cifrado.
