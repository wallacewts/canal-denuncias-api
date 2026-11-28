/**
 * Token do destino dos logs. Em produção é `null` (stdout). Os testes o substituem por um stream em memória
 * (`test/support/log-capture.ts`) para provar que nenhum dado sensível vai para o log.
 */
export const LOG_DESTINATION = Symbol('LOG_DESTINATION');
