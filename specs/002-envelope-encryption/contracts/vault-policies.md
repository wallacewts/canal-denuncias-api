# Contrato: políticas e perfis do Vault

## Perfis

| Perfil (AppRole)  | Quem usa                        | Ambientes                         |
| ----------------- | ------------------------------- | --------------------------------- |
| `api`             | a API                           | desenvolvimento e produção        |
| `maintenance`     | o comando `rewrap-keys`         | desenvolvimento e produção        |
| `identity-worker` | o serviço isolado de identidade | produção (implementado no IDV-06) |

## Permissões

| Caminho                                | `api` | `maintenance` | `identity-worker` |
| -------------------------------------- | :---: | :-----------: | :---------------: |
| `transit/datakey/plaintext/report-kek` |  ✅   |               |                   |
| `transit/decrypt/report-kek`           |  ✅   |               |                   |
| `transit/rewrap/report-kek`            |       |      ✅       |                   |
| `transit/keys/report-kek` (read)       |       |      ✅       |                   |
| `transit/encrypt/app-kek`              |  ✅   |               |                   |
| `transit/decrypt/app-kek`              |  ✅   |               |                   |
| `transit/encrypt/identity-kek`         |       |               |        ✅         |
| `transit/decrypt/identity-kek`         |       |               |        ✅         |
| qualquer outro caminho                 |       |               |                   |

Os arquivos ficam em `docs/deploy/vault/policies/`. No ambiente local, `docker/vault/api-dev-policy.hcl` e
`docker/vault/maintenance-dev-policy.hcl` seguem a mesma tabela.

## Verificação automática (`test/crypto/vault-policies.e2e-spec.ts`)

Com o token root do Vault de desenvolvimento, o teste grava as políticas de `docs/deploy/vault/policies/` com nomes de
teste, cria um token para cada uma e confere cada célula da tabela: permitido responde 200, proibido responde 403.

## Operação em produção (`docs/deploy/vault/README.md`)

- Inicialização com 5 partes de chave e quórum de 3 (Shamir), distribuídas entre pessoas diferentes.
- Armazenamento integrado (raft) e snapshots periódicos de backup, guardados com o mesmo cuidado do backup do banco.
- Audit device em arquivo ligado desde a inicialização.
- AppRoles com `secret_id` de vida limitada e entregue ao container por segredo, nunca em variável no repositório.
- Container da API sem core dump (`ulimit -c 0`), sem `--inspect` e sem heap snapshot.
