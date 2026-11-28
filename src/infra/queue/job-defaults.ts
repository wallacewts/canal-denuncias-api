import type { JobsOptions } from 'bullmq';

/**
 * Padrões aplicados a todas as filas (FR-017): tentativas com intervalo crescente e histórico limitado no Redis.
 * Jobs que chamam serviços externos podem ser executados mais de uma vez, então precisam ser idempotentes.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
} satisfies JobsOptions;

/**
 * Id determinístico do job, derivado da tarefa: o mesmo pedido enfileirado duas vezes roda uma vez só.
 * Usa `.` como separador porque o BullMQ recusa `:` em ids personalizados.
 */
export function jobId(task: string, ...ids: string[]): string {
  return [task, ...ids].join('.');
}
