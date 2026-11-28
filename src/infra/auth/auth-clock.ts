/**
 * Relógio da autenticação (epoch em ms), injetado nas opções `now` da sessão e do MFA. Em produção é o relógio do
 * sistema; os testes trocam o provider para avançar 15 min ou 8 h sem esperar (R9).
 */
export interface AuthClock {
  now(): number;
}

export const AUTH_CLOCK = Symbol('AUTH_CLOCK');

export const systemClock: AuthClock = { now: () => Date.now() };
