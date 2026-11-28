import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli/cli.module.js';

/**
 * CLI administrativa (D31): `npm run cli -- create-admin --name "..." --email "..."` ou, no container,
 * `node dist/cli.js create-admin ...`. Erros mostram só a mensagem, sem stack.
 */
await CommandFactory.run(CliModule, {
  logger: ['error', 'warn'],
  errorHandler: (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  },
  serviceErrorHandler: (error) => {
    process.stderr.write(`Erro: ${error.message}\n`);
    process.exitCode = 1;
  },
});
