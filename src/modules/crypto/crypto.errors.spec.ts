import { inspect } from 'node:util';
import {
  ContentSchemaError,
  ContentUnavailableError,
  DecryptionFailedError,
  UnsupportedFormatError,
} from './crypto.errors.js';

/** Tudo que um erro pode expor: mensagem, pilha, propriedades e serializações. */
function exposed(error: Error): string {
  return [error.message, error.stack, JSON.stringify(error), inspect(error, { depth: 5 })].join('\n');
}

const CURTO = 'XQZ';
const LONGO = 'relato longo de vazamento '.repeat(40);

describe('erros de criptografia', () => {
  const casos: Array<[string, () => Error, string]> = [
    ['DecryptionFailedError', () => new DecryptionFailedError(), 'Não foi possível abrir o conteúdo cifrado'],
    ['UnsupportedFormatError', () => new UnsupportedFormatError(), 'Formato de conteúdo cifrado não suportado'],
    ['ContentSchemaError', () => new ContentSchemaError(), 'Conteúdo cifrado fora do formato esperado'],
    ['ContentUnavailableError', () => new ContentUnavailableError(), 'Conteúdo indisponível'],
  ];

  it.each(casos)('%s tem mensagem fixa e não tem cause', (_nome, criar, mensagem) => {
    const error = criar();
    expect(error.message).toBe(mensagem);
    expect(error).not.toHaveProperty('cause');
  });

  it.each(casos)('%s não carrega texto, chave ou valor mesmo se o chamador tentar passar', (_nome, criar) => {
    // Os construtores não aceitam argumentos: um chamador descuidado não consegue anexar o conteúdo.
    const Ctor = criar().constructor as new (...args: unknown[]) => Error;
    for (const segredo of [CURTO, LONGO]) {
      const error = new Ctor(segredo, { cause: new Error(segredo) });
      expect(exposed(error)).not.toContain(segredo);
      expect(error).not.toHaveProperty('cause');
    }
  });
});
