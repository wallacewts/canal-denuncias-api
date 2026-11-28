# Contrato: extensão do KeyService (feature 001)

Extensão compatível do contrato `specs/001-transversal-infrastructure/contracts/key-service.md`. Nenhum chamador
existente muda.

```ts
interface KeyService {
  generateDataKey(kek: AllowedKek): Promise<DataKey>;
  decryptDataKey(kek: AllowedKek, wrapped: string): Promise<Buffer>;
  encrypt(kek: AllowedKek, plaintext: Buffer, options?: { associatedData?: Buffer }): Promise<string>; // novo: options
  decrypt(kek: AllowedKek, ciphertext: string, options?: { associatedData?: Buffer }): Promise<Buffer>; // novo: options
  rewrap(kek: AllowedKek, ciphertext: string): Promise<string>;
  latestVersion(kek: AllowedKek): Promise<number>; // novo
}
```

| Método          | Endpoint do Vault                          | Observação                                                |
| --------------- | ------------------------------------------ | --------------------------------------------------------- |
| `encrypt`       | `transit/encrypt/:kek`                     | `associated_data` em base64 quando informado              |
| `decrypt`       | `transit/decrypt/:kek`                     | idem; contexto diferente → `KeyServiceRequestError` (400) |
| `latestVersion` | `GET transit/keys/:kek` (`latest_version`) | precisa de `read` na chave; só o perfil de manutenção tem |

A allowlist (`report-kek`, `app-kek`), o timeout, o 503 e a regra de erro sem conteúdo continuam iguais.

A credencial da API **perde** `rewrap` (R10). O método continua no contrato porque o comando de recifragem usa o
mesmo cliente, autenticado com o perfil de manutenção.
