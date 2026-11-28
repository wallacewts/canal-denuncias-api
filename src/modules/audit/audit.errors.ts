/** Motivo de uma recusa: só o código da regra e o caminho do campo, nunca o valor recebido. */
export interface AuditRejectionReason {
  code: string;
  path: string;
}

/**
 * Registro recusado antes de chegar à trilha (ação ou tipo fora do catálogo, identificador inválido, metadata fora do
 * formato). Mensagem fixa e sem `cause`: nada do que foi recusado pode aparecer em erro ou log (princípio II).
 */
export class AuditEntryRejected extends Error {
  override readonly name = 'AuditEntryRejected';

  constructor(readonly reasons: AuditRejectionReason[]) {
    super('Registro de auditoria recusado.');
  }
}
