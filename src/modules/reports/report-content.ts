/**
 * Conteúdo do relato antes da cifragem. Vai inteiro para `reports.content_enc`,
 * para que nem a lista de campos preenchidos fique visível no banco.
 * O campo `v` permite evoluir o formato sem reescrever denúncias antigas.
 */
export interface ReportContentV1 {
  v: 1;
  description: string;
  /** Data ISO ou período aproximado ("2026-10"). */
  occurredOn?: string;
  location?: string;
  affectedSystems?: string;
  /** dados pessoais, financeiros, credenciais... */
  dataTypes?: string[];
  involved?: { name?: string; role?: string }[];
  howKnown?: string;
  evidenceNotes?: string;
}
