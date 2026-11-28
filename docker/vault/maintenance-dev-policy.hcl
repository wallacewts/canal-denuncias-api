# Perfil de manutenção no Vault de DESENVOLVIMENTO (D43): só a recifragem das chaves das denúncias.
# Igual a docs/deploy/vault/policies/maintenance.hcl (conferido por test/crypto/vault-policies.e2e-spec.ts).
path "transit/rewrap/report-kek" { capabilities = ["update"] }
path "transit/keys/report-kek"   { capabilities = ["read"] }
