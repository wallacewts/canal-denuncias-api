import { Injectable } from '@nestjs/common';

/** Terminal usado pelo prompt. Injetável só para os testes; em uso real é o processo atual. */
export interface PromptTerminal {
  stdin: Pick<NodeJS.ReadStream, 'isTTY' | 'setRawMode' | 'setEncoding' | 'resume' | 'pause' | 'on' | 'off'>;
  stdout: Pick<NodeJS.WriteStream, 'write'>;
}

/**
 * Lê a senha no terminal, sem eco (D31). Recusa rodar sem TTY: senha vinda de pipe acaba em scripts e no histórico
 * do shell, e por argumento ou variável de ambiente fica visível na lista de processos.
 */
@Injectable()
export class PasswordPrompt {
  ask(question: string, terminal: PromptTerminal = { stdin: process.stdin, stdout: process.stdout }): Promise<string> {
    const { stdin, stdout } = terminal;
    if (!stdin.isTTY) {
      return Promise.reject(
        new Error('Este comando precisa de um terminal interativo: a senha é digitada, nunca passada por pipe.'),
      );
    }

    return new Promise((resolve, reject) => {
      stdout.write(question);
      let value = '';

      const finish = () => {
        stdin.off('data', onData);
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write('\n');
      };

      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === '\r' || ch === '\n') {
            finish();
            resolve(value);
            return;
          }
          if (ch === '\u0003' || ch === '\u0004') {
            finish();
            reject(new Error('Operação cancelada.'));
            return;
          }
          if (ch === '\u007f' || ch === '\b') {
            value = [...value].slice(0, -1).join('');
          } else if (ch >= ' ') {
            value += ch;
          }
        }
      };

      stdin.setRawMode(true);
      stdin.setEncoding('utf8');
      stdin.resume();
      stdin.on('data', onData);
    });
  }
}
