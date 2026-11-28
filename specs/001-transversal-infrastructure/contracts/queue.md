# Contrato: fila (TRV-05)

| Fila            | Uso previsto                                           | Jobs agendados                                                                             |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `notifications` | E-mails internos sem conteúdo (módulo notifications)   | não                                                                                        |
| `maintenance`   | Expurgo, rewrap de chaves (módulos retention e crypto) | sim, via `upsertJobScheduler` (uma execução por disparo, em qualquer número de instâncias) |

**Payload**: todo job declara um schema zod. O schema base aceita só UUID, códigos de enum e números. Um teste falha
se o schema de algum job aceitar texto livre.

**Padrões**: `attempts: 5`, backoff exponencial a partir de 5 s, `removeOnComplete: { count: 1000 }`,
`removeOnFail: { count: 5000 }` e `jobId` determinístico derivado da tarefa.
