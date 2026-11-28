# Serviço isolado de identidade em produção (IDV-06, D24). Único perfil com acesso à identity-kek.
# Envelope encryption da identificação: gera a DEK (datakey) ao gravar e abre a DEK (decrypt) na revelação.
# Implementado na feature identity-vault; aqui fica só a política.
path "transit/datakey/plaintext/identity-kek" { capabilities = ["update"] }
path "transit/decrypt/identity-kek"           { capabilities = ["update"] }
