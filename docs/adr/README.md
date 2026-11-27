# Registro de decisões de arquitetura

Versão navegável: <https://claude.ai/artifact/9u2T2nWdWyiUkcB4Nj5Ahq> (acesso restrito; peça a quem mantém o
documento).

Novas decisões entram como arquivos `NNNN-titulo.md` nesta pasta, a partir do [modelo](template.md).

| #   | Tema                      | Decisão                                                                                                                                      | Status           |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| D01 | Stack                     | Angular no front, NestJS + PostgreSQL no back, em dois repositórios dockerizados                                                             | Decidido         |
| D02 | Clientes                  | Uma única empresa (sem multi-tenant)                                                                                                         | Decidido         |
| D03 | Login da equipe           | Login próprio, senha argon2id e MFA obrigatório por TOTP                                                                                     | Decidido         |
| D04 | Hospedagem                | On-premise: Vault para chaves, storage S3-compatível para anexos                                                                             | Decidido         |
| D05 | Acesso do denunciante     | Sem conta. Protocolo + chave por denúncia, só o hash da chave é guardado                                                                     | Decidido         |
| D06 | Contato com o denunciante | Só acompanhamento por protocolo, sem e-mail                                                                                                  | Decidido         |
| D07 | Organização do front      | Workspace Angular com 2 apps (portal e backoffice) e uma lib compartilhada                                                                   | Decidido         |
| D08 | Criptografia              | Envelope encryption: DEK por denúncia, KEKs no Vault Transit, AES-256-GCM com AAD                                                            | Decidido         |
| D09 | Identidade do denunciante | Opcional, chave própria, revelação com justificativa e aprovação de outra pessoa                                                             | Decidido         |
| D10 | Controle de acesso        | RBAC + ABAC (CASL), 5 perfis, acesso por atribuição, conflito de interesse                                                                   | Decidido         |
| D11 | Auditoria                 | Append-only com cadeia de hash, protegida por permissão e trigger                                                                            | Decidido         |
| D12 | ORM                       | TypeORM, migrations geradas e revisadas                                                                                                      | Decidido         |
| D13 | Identificadores           | UUID v7 gerado pelo Postgres 18                                                                                                              | Decidido         |
| D14 | Retenção                  | Expurgo por crypto-shredding, prazo conforme o desfecho                                                                                      | Prazos a validar |
| D15 | Spam e abuso              | Fora do escopo por enquanto                                                                                                                  | Fora do escopo   |
| D16 | Login para denunciar      | Não será exigido                                                                                                                             | Fora do escopo   |
| D17 | Storage de anexos (local) | SeaweedFS no lugar do MinIO, que deixou de publicar imagens no Docker Hub. O código usa a API S3, então o storage de produção pode ser outro | Decidido         |
| D18 | Telemetria                | NestJS Observe removido: nenhum dado sai para serviços externos                                                                              | Decidido         |
