import { Injectable } from '@nestjs/common';

/** Saída da CLI. Substituída nos testes. Nunca recebe senha nem hash. */
@Injectable()
export class CliOutput {
  info(message: string): void {
    process.stdout.write(`${message}\n`);
  }

  error(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}
