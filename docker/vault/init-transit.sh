#!/bin/sh
# Somente desenvolvimento: habilita o Transit, cria as 3 KEKs do sistema e os AppRoles da API e de manutenção,
# com IDs fixos.
# Em produção o Vault roda em modo servidor, com unseal por Shamir e as políticas de CRYPTO-07.
set -eu

vault secrets list | grep -q '^transit/' || vault secrets enable transit
for key in report-kek identity-kek app-kek; do
  vault read "transit/keys/$key" >/dev/null 2>&1 || vault write -f "transit/keys/$key" type=aes256-gcm96
done

vault policy write api-dev /api-dev-policy.hcl
vault auth list | grep -q '^approle/' || vault auth enable approle
vault write auth/approle/role/api token_policies=api-dev token_ttl=1h token_max_ttl=4h secret_id_ttl=0
vault write auth/approle/role/api/role-id role_id=dev-api-role-id
vault list auth/approle/role/api/secret-id >/dev/null 2>&1 \
  || vault write auth/approle/role/api/custom-secret-id secret_id=dev-api-secret-id

# Perfil de manutenção (D43): só para o comando rewrap-keys.
vault policy write maintenance-dev /maintenance-dev-policy.hcl
vault write auth/approle/role/maintenance token_policies=maintenance-dev token_ttl=1h token_max_ttl=4h secret_id_ttl=0
vault write auth/approle/role/maintenance/role-id role_id=dev-maintenance-role-id
vault list auth/approle/role/maintenance/secret-id >/dev/null 2>&1 \
  || vault write auth/approle/role/maintenance/custom-secret-id secret_id=dev-maintenance-secret-id

echo "Vault pronto: report-kek, identity-kek, app-kek e AppRoles 'api' (api-dev) e 'maintenance' (maintenance-dev)"
