import { runAsSystem } from '../../modules/audit/audit-context.js';

/**
 * Envolve o handler de um job para rodar com ator sistema na auditoria (D46). Todo processador de fila usa este
 * helper: fora dele, um registro de auditoria feito pelo job é recusado (ator indeterminado).
 */
export function systemJob<P, R>(handler: (payload: P) => Promise<R>): (payload: P) => Promise<R> {
  return (payload) => runAsSystem(() => handler(payload));
}
