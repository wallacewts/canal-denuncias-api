# Perfil de manutenção em produção (CRYPTO-06, D43): só o comando rewrap-keys.
# Lê a versão atual da report-kek e recifra as chaves de dados; não gera nem abre chaves.
path "transit/rewrap/report-kek" { capabilities = ["update"] }
path "transit/keys/report-kek"   { capabilities = ["read"] }
