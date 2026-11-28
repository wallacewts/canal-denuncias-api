# Contrato: comando `create-admin` (TRV-09)

```text
npm run cli -- create-admin --name "<nome>" --email "<email>" [--force]
node dist/cli.js create-admin --name "<nome>" --email "<email>" [--force]   # dentro do container
```

| Passo                 | Comportamento                                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Senha                 | Pedida no TTY duas vezes, sem eco. Nunca aceita por argumento nem por variável de ambiente                                                                                                                                   |
| Política              | No mínimo 12 caracteres e fora da lista local de senhas comuns. Se for recusada, explica o motivo e pede de novo (até 3 vezes)                                                                                               |
| Já existe ADMIN ativo | Sai com código 1 e uma mensagem, a menos que receba `--force`                                                                                                                                                                |
| E-mail já cadastrado  | Sai com código 1 ("e-mail já cadastrado"), detectado pela constraint                                                                                                                                                         |
| Hash                  | scrypt do `PasswordHasher` do `@nestjs/authentication` (`$scrypt$ln=17,r=8,p=1$...`), D32                                                                                                                                    |
| Sucesso               | Cria o usuário `ACTIVE` com o perfil `ADMIN` e sem MFA (cadastro obrigatório no primeiro login), grava `USER_CREATED` (`actor_type = SYSTEM`, metadata `{ roles: ["ADMIN"], forced }`) na mesma transação e sai com código 0 |
| Saída                 | Nunca imprime a senha nem o hash                                                                                                                                                                                             |
