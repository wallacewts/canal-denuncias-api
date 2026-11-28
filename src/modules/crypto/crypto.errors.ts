/**
 * Erros da camada de criptografia (R9). Todos têm mensagem fixa e construtor sem parâmetros: não há como anexar texto
 * em claro, chave, valor cifrado ou o erro original do OpenSSL. O filtro global trata como 500 genérico; o
 * `ContentUnavailableError` é traduzido pelo módulo que o recebe (ex.: 410 no acompanhamento).
 */
abstract class CryptoError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Contexto errado, dado ou tag adulterados, chave errada. */
export class DecryptionFailedError extends CryptoError {
  constructor() {
    super('Não foi possível abrir o conteúdo cifrado');
  }
}

/** Versão de formato desconhecida ou tamanho impossível. */
export class UnsupportedFormatError extends CryptoError {
  constructor() {
    super('Formato de conteúdo cifrado não suportado');
  }
}

/** JSON aberto fora do schema da sua versão. Não carrega as issues do schema. */
export class ContentSchemaError extends CryptoError {
  constructor() {
    super('Conteúdo cifrado fora do formato esperado');
  }
}

/** A chave de dados foi destruída pelo expurgo (`wrapped_dek` nulo). */
export class ContentUnavailableError extends CryptoError {
  constructor() {
    super('Conteúdo indisponível');
  }
}
