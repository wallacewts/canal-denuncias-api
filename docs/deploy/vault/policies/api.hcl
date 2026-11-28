# Política da API em produção (CRYPTO-07, D24, D43). Acesso mínimo:
# - gerar e abrir chaves de dados das denúncias (report-kek);
# - cifrar e decifrar segredos da aplicação (app-kek, ex.: segredo de MFA, com associated_data).
# Nenhuma permissão na identity-kek (só o identity-worker) e sem rewrap (só o perfil de manutenção).
path "transit/datakey/plaintext/report-kek" { capabilities = ["update"] }
path "transit/decrypt/report-kek"           { capabilities = ["update"] }
path "transit/encrypt/app-kek"              { capabilities = ["update"] }
path "transit/decrypt/app-kek"              { capabilities = ["update"] }
