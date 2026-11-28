# Vault em produção

Passo a passo de operação do HashiCorp Vault que guarda as chaves mestras (KEKs) do canal de denúncias. As decisões
estão em `docs/adr/README.md` (D08, D24, D28, D41 a D43) e o contrato em
`specs/002-envelope-encryption/contracts/vault-policies.md`.

## Chaves e perfis

| KEK            | Protege                                         | Quem usa                               |
| -------------- | ----------------------------------------------- | -------------------------------------- |
| `report-kek`   | a chave de dados (DEK) de cada denúncia         | API (gera e abre), manutenção (rewrap) |
| `app-kek`      | segredos pequenos da aplicação (segredo de MFA) | API                                    |
| `identity-kek` | a DEK da identificação opcional do denunciante  | só o `identity-worker` (IDV-06)        |

Políticas em [`policies/`](policies/): `api.hcl`, `maintenance.hcl` e `identity-worker.hcl`. Elas são conferidas
automaticamente contra um Vault de teste por `test/crypto/vault-policies.e2e-spec.ts`, e as de desenvolvimento
(`docker/vault/*-dev-policy.hcl`) precisam conceder exatamente o mesmo.

## 1. Inicialização

1. Suba o Vault em modo servidor com armazenamento integrado (raft) e TLS. Nunca use `-dev` fora do ambiente local.
2. Inicialize com **5 partes de chave e quórum de 3** (Shamir):

   ```bash
   vault operator init -key-shares=5 -key-threshold=3
   ```

   Entregue cada parte a uma pessoa diferente, por um canal separado. Nenhuma pessoa guarda mais de uma parte. O
   token root inicial é usado só para a configuração abaixo e revogado em seguida (`vault token revoke`).

3. Abra (unseal) com 3 partes a cada reinício: `vault operator unseal` três vezes, por três pessoas.

## 2. Auditoria do próprio Vault

Ligue o audit device antes de qualquer outra configuração, para que tudo fique registrado:

```bash
vault audit enable file file_path=/vault/audit/audit.log
```

O arquivo de auditoria do Vault registra quem pediu o quê. Os valores sensíveis aparecem com HMAC, não em claro.

## 3. Chaves e políticas

```bash
vault secrets enable transit
for key in report-kek identity-kek app-kek; do vault write -f "transit/keys/$key" type=aes256-gcm96; done

vault policy write api policies/api.hcl
vault policy write maintenance policies/maintenance.hcl
vault policy write identity-worker policies/identity-worker.hcl

vault auth enable approle
vault write auth/approle/role/api token_policies=api token_ttl=1h token_max_ttl=4h secret_id_ttl=720h
vault write auth/approle/role/maintenance token_policies=maintenance token_ttl=1h token_max_ttl=4h secret_id_ttl=24h
vault write auth/approle/role/identity-worker token_policies=identity-worker token_ttl=1h token_max_ttl=4h secret_id_ttl=720h
```

- O `role_id` e o `secret_id` de cada AppRole são entregues ao container por segredo (Docker secrets ou o mecanismo
  equivalente do orquestrador), nunca em variável commitada no repositório.
- O `secret_id` do perfil `maintenance` tem vida curta: gere um novo (`vault write -f
auth/approle/role/maintenance/secret-id`) só quando for rodar a recifragem.

## 4. Backup

- Snapshots periódicos do raft (`vault operator raft snapshot save`), cifrados e guardados com o mesmo cuidado do backup
  do banco. Sem o Vault, as denúncias do banco não podem ser abertas; com o Vault e um backup do banco, podem.
- As partes de chave (Shamir) não ficam junto dos snapshots.
- Teste a restauração em ambiente separado pelo menos a cada trimestre.
- Lembrete (D26): os backups do banco são mantidos por tempo indeterminado e guardam as chaves protegidas das denúncias
  já expurgadas. Isso precisa constar no RIPD.

## 5. Rotação das chaves e recifragem

1. Gire a KEK: `vault write -f transit/keys/report-kek/rotate` (com um token de operação, não o da API).
2. Rode a recifragem com o perfil de manutenção, no container da API:

   ```bash
   VAULT_TOKEN= VAULT_ROLE_ID=<role_id maintenance> VAULT_SECRET_ID=<secret_id maintenance> \
     node dist/cli.js rewrap-keys --kek report-kek
   ```

   A saída mostra só contagens e a versão atual. A execução é retomável: se for interrompida, rode de novo. Cada lote e
   cada execução ficam na trilha de auditoria (`KEYS_REWRAPPED` e `KEYS_REWRAP_RUN`).

3. Depois de conferir que nada ficou para trás, a versão mínima de decifragem pode ser elevada
   (`min_decryption_version`). Isso torna ilegíveis as chaves antigas presentes em backups. É uma decisão da feature de
   retenção e do DPO.

## 6. Container da API

- Sem core dump: `ulimit -c 0` (ou `--ulimit core=0` no Docker).
- Sem `--inspect` e sem heap snapshot em produção. A chave de dados em claro existe na memória durante cada operação
  (D41 e R2 da feature 002), e um dump de memória poderia expô-la.
- A API nunca recebe credencial do perfil `maintenance` nem do `identity-worker`.
