import { EventEmitter } from 'node:events';
import { PasswordPrompt, type PromptTerminal } from './password-prompt.js';

function fakeTerminal(isTTY = true) {
  const input = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const written: string[] = [];
  const raw: boolean[] = [];
  Object.assign(input, {
    isTTY,
    setRawMode: (on: boolean) => raw.push(on),
    setEncoding: () => undefined,
    resume: () => undefined,
    pause: () => undefined,
  });
  const terminal = {
    stdin: input,
    stdout: { write: (text: string) => written.push(text) },
  } as unknown as PromptTerminal;
  return { terminal, input, written, raw };
}

describe('PasswordPrompt', () => {
  const prompt = new PasswordPrompt();

  it('lê a senha sem ecoar nada além da pergunta e da quebra de linha', async () => {
    const { terminal, input, written, raw } = fakeTerminal();
    const answer = prompt.ask('Senha: ', terminal);
    input.emit('data', 'XQZ segredo');
    input.emit('data', '\r');
    expect(await answer).toBe('XQZ segredo');
    expect(written).toEqual(['Senha: ', '\n']);
    expect(raw).toEqual([true, false]);
  });

  it('aceita Enter como \\n e trata backspace', async () => {
    const { terminal, input } = fakeTerminal();
    const answer = prompt.ask('Senha: ', terminal);
    input.emit('data', 'abcX\u007f\b\u007fd\n');
    expect(await answer).toBe('ad');
  });

  it('ignora caracteres de controle', async () => {
    const { terminal, input } = fakeTerminal();
    const answer = prompt.ask('Senha: ', terminal);
    input.emit('data', 'a\u001bb\tc\r');
    expect(await answer).toBe('abc');
  });

  it('Ctrl+C cancela e restaura o terminal', async () => {
    const { terminal, input, raw } = fakeTerminal();
    const answer = prompt.ask('Senha: ', terminal);
    input.emit('data', 'parcial\u0003');
    await expect(answer).rejects.toThrow(/cancelada/);
    expect(raw).toEqual([true, false]);
  });

  it('recusa rodar sem terminal interativo (senha por pipe)', async () => {
    const { terminal, written } = fakeTerminal(false);
    await expect(prompt.ask('Senha: ', terminal)).rejects.toThrow(/terminal interativo/);
    expect(written).toEqual([]);
  });
});
