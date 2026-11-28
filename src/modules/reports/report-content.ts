import { z } from 'zod';
import { strictObject, text } from '../../common/validation/schemas.js';

/** Tipos de dado vazado aceitos (REP-02; lista proposta pelo front na feature 002 do repositório web). */
export const REPORT_DATA_TYPES = ['PERSONAL', 'FINANCIAL', 'CREDENTIALS', 'OTHER'] as const;

/** Data ISO (`AAAA-MM-DD`) ou período aproximado (`AAAA-MM`). */
const OCCURRED_ON = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

/**
 * Conteúdo do relato antes da cifragem, versão 1. Vai inteiro para `reports.content_enc`, para que nem a lista de
 * campos preenchidos fique visível no banco. O campo `v` permite evoluir o formato sem reescrever denúncias antigas.
 *
 * Este schema valida a **estrutura** na abertura (CRYPTO-03). As regras de entrada do formulário (ex.: descrição
 * mínima de 100 caracteres) ficam no schema de entrada do REP-02.
 */
export const ReportContentV1Schema = strictObject({
  v: z.literal(1),
  description: text({ min: 1, max: 10_000 }),
  occurredOn: z.string().regex(OCCURRED_ON, { message: 'data inválida' }).optional(),
  location: text().optional(),
  affectedSystems: text().optional(),
  dataTypes: z
    .array(z.enum(REPORT_DATA_TYPES))
    .max(REPORT_DATA_TYPES.length)
    .refine((list) => new Set(list).size === list.length, { message: 'tipos de dado repetidos' })
    .optional(),
  involved: z
    .array(strictObject({ name: text({ max: 200 }).optional(), role: text({ max: 200 }).optional() }))
    .max(20)
    .optional(),
  howKnown: text().optional(),
  evidenceNotes: text().optional(),
});

export type ReportContentV1 = z.infer<typeof ReportContentV1Schema>;
export type ReportDataType = (typeof REPORT_DATA_TYPES)[number];
