# Política da API no Vault de DESENVOLVIMENTO. Acesso mínimo: nenhuma permissão na identity-kek (D24) e sem rewrap
# (D43: a recifragem é do perfil de manutenção). Igual a docs/deploy/vault/policies/api.hcl
# (conferido por test/crypto/vault-policies.e2e-spec.ts).
path "transit/datakey/plaintext/report-kek" { capabilities = ["update"] }
path "transit/decrypt/report-kek"           { capabilities = ["update"] }
path "transit/encrypt/app-kek"              { capabilities = ["update"] }
path "transit/decrypt/app-kek"              { capabilities = ["update"] }
