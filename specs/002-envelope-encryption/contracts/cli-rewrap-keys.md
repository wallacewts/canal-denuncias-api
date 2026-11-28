# Contrato: comando `rewrap-keys`

```bash
npm run cli -- rewrap-keys --kek report-kek [--batch-size 200]
```

Roda com a credencial do perfil de manutenção (`VAULT_ROLE_ID`/`VAULT_SECRET_ID` do AppRole `maintenance`). Com a
credencial da API, o Vault recusa (403) e o comando termina com código 1.

| Opção          | Regra                                                       |
| -------------- | ----------------------------------------------------------- |
| `--kek`        | obrigatória; só `report-kek` (a `identity-kek` é do IDV-06) |
| `--batch-size` | opcional, de 1 a 1000, padrão 200                           |

## Comportamento

1. Lê `latest_version` da chave.
2. Percorre `reports` por id crescente, em lotes, só onde `wrapped_dek` não é nulo e não começa com
   `vault:v<latest>:`.
3. Para cada lote: `rewrap` de cada linha no Vault, fora de transação; depois **uma** transação com os
   `UPDATE reports SET wrapped_dek = $novo WHERE id = $id AND wrapped_dek = $antigo` do lote e o registro
   `KEYS_REWRAPPED` do lote. `affected = 0` conta como ignorada.
4. No fim, com sucesso, erro ou interrupção (SIGINT/SIGTERM), grava `KEYS_REWRAP_RUN` com o resumo (ver
   [data-model.md](../data-model.md)).

## Saída

| Situação                            | Saída (stdout)                                              | Código |
| ----------------------------------- | ----------------------------------------------------------- | ------ |
| Tudo recifrado                      | `Recifradas: N. Ignoradas: M. Falhas: 0. Versão atual: vX.` | 0      |
| Nada a fazer                        | `Nada a recifrar. Versão atual: vX.`                        | 0      |
| Falhas em linhas                    | resumo com o número de falhas (sem ids, sem valores)        | 1      |
| Vault indisponível ou sem permissão | `Serviço de chaves indisponível ou sem permissão.`          | 1      |

Nenhuma saída contém valor de `wrapped_dek`, chave ou id de denúncia.
