# Contrato: formato do campo cifrado v1

```text
offset  tamanho  conteúdo
0       1        versão (0x01)
1       12       nonce aleatório (randomBytes)
13      N        ciphertext (AES-256-GCM)
13+N    16       tag de autenticação GCM
```

- Algoritmo: `aes-256-gcm`, chave de 32 bytes, nonce de 12 bytes, tag de 16 bytes.
- AAD: bytes UTF-8 do contexto `"<tabela>.<campo>:<id>"` (ou `":<id1>.<id2>"` para chave composta), montado só por
  `encryptionContext()`.
- Nonce novo a cada cifragem. Dois cifrados do mesmo texto com a mesma chave são sempre diferentes.

## Abertura

| Situação                                           | Resultado                |
| -------------------------------------------------- | ------------------------ |
| Menos de 29 bytes                                  | `UnsupportedFormatError` |
| Byte 0 diferente de `0x01`                         | `UnsupportedFormatError` |
| Contexto diferente do usado na cifragem            | `DecryptionFailedError`  |
| Qualquer byte do nonce, ciphertext ou tag alterado | `DecryptionFailedError`  |
| Chave diferente                                    | `DecryptionFailedError`  |
| Texto em claro vazio                               | abre e devolve vazio     |

Compatível com o que as factories da feature 001 já gravavam (mesmo formato), então nenhum dado de teste precisa ser
regravado.
