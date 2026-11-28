# Política da API no Vault de DESENVOLVIMENTO. Acesso mínimo: nenhuma permissão na identity-kek (D24).
# As políticas de produção são entregues em CRYPTO-07 (docs/deploy/vault/).
path "transit/datakey/plaintext/report-kek" { capabilities = ["update"] }
path "transit/decrypt/report-kek"           { capabilities = ["update"] }
path "transit/rewrap/report-kek"            { capabilities = ["update"] }
path "transit/encrypt/app-kek"              { capabilities = ["update"] }
path "transit/decrypt/app-kek"              { capabilities = ["update"] }
path "transit/rewrap/app-kek"               { capabilities = ["update"] }
