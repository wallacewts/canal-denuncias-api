# Contrato: formato de arquivo cifrado STREAM v1

Construção STREAM (blocos autenticados), usada para os anexos.

```text
cabeçalho (13 bytes)
  [versão: 1 byte = 0x01][tamanho do bloco: 4 bytes BE = 65536][prefixo de nonce: 8 bytes aleatórios]

bloco i (i = 0, 1, 2, ...)
  [ciphertext: até 65536 bytes][tag: 16 bytes]
```

- Nonce do bloco `i`: prefixo (8 bytes) seguido de `i` em uint32 big-endian (4 bytes).
- AAD do bloco `i`: contexto `"attachments.object:<id>"` em UTF-8, seguido de 1 byte de marcação (`0x01` no último
  bloco, `0x00` nos demais). No bloco 0, os 13 bytes do cabeçalho vêm antes do contexto.
- Todos os blocos têm 65536 bytes de texto em claro, menos o último, que tem de 0 a 65536 bytes e é sempre marcado.
  Um arquivo vazio vira cabeçalho + um bloco vazio marcado.
- Máximo de 2³² blocos (256 TiB).

## Garantias

| Ataque ou falha                     | Detectado por                      |
| ----------------------------------- | ---------------------------------- |
| Byte alterado em qualquer bloco     | tag do bloco                       |
| Blocos trocados de ordem            | contador no nonce                  |
| Arquivo cortado no fim de um bloco  | falta do bloco marcado como último |
| Arquivo cortado no meio de um bloco | tag do bloco                       |
| Cabeçalho alterado                  | cabeçalho na AAD do bloco 0        |
| Arquivo de outro anexo              | contexto com o id do anexo         |

O decifrador só entrega o texto em claro de um bloco depois de verificar a tag dele. Em caso de falha, o stream
emite `DecryptionFailedError`, e quem consome descarta o que já recebeu.

## Integridade do cifrado

`createEncryptStream` calcula o sha256 dos bytes cifrados (cabeçalho incluído) durante a escrita. O valor fica
disponível ao fim do stream, para `attachments.ciphertext_hash`.
