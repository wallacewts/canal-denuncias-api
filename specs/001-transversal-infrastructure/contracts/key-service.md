# Contrato: serviço de chaves (TRV-04)

Interface que o `VaultModule` exporta para os outros módulos (o `crypto` é o principal consumidor).

```ts
type AllowedKek = 'report-kek' | 'app-kek'; // 'identity-kek' é recusada (D24)

interface KeyService {
  generateDataKey(kek: AllowedKek): Promise<{ plaintext: Buffer; wrapped: string }>;
  decryptDataKey(kek: AllowedKek, wrapped: string): Promise<Buffer>;
  encrypt(kek: AllowedKek, plaintext: Buffer): Promise<string>;
  decrypt(kek: AllowedKek, ciphertext: string): Promise<Buffer>;
  rewrap(kek: AllowedKek, ciphertext: string): Promise<string>;
}
```

| Situação                                                       | Comportamento                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| Vault selado, fora do ar ou sem resposta em `VAULT_TIMEOUT_MS` | `KeyServiceUnavailableError` → 503 para o cliente da API            |
| KEK fora da allowlist                                          | `Error` de programação antes de qualquer chamada de rede            |
| Token perto de expirar (produção)                              | Renovação quando 2/3 do TTL passarem. Se falhar, novo login AppRole |
| Qualquer erro                                                  | Mensagem e propriedades sem plaintext, chave, `wrapped` ou token    |

Endpoints do Vault usados: `auth/approle/login`, `auth/token/renew-self`, `transit/datakey/plaintext/:kek`,
`transit/decrypt/:kek`, `transit/encrypt/:kek`, `transit/rewrap/:kek`.

> Estendido pela feature 002: `associatedData` em `encrypt`/`decrypt` e `latestVersion`, e a API perdeu o `rewrap`.
> Ver `specs/002-envelope-encryption/contracts/key-service-v2.md`.
