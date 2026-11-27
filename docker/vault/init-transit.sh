#!/bin/sh
# Somente desenvolvimento: habilita o Transit e cria as 3 KEKs do sistema no Vault em modo dev.
# Em produção o Vault roda em modo servidor, com unseal por Shamir e políticas por KEK.
set -eu

vault secrets list | grep -q '^transit/' || vault secrets enable transit
for key in report-kek identity-kek app-kek; do
  vault read "transit/keys/$key" >/dev/null 2>&1 || vault write -f "transit/keys/$key" type=aes256-gcm96
done
echo "Vault Transit pronto: report-kek, identity-kek, app-kek"
