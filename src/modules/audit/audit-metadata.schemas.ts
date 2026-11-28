import { z } from 'zod';
import { Priority } from '../../common/enums/priority.enum.js';
import { ReportOutcome } from '../../common/enums/report-outcome.enum.js';
import { ReportStatus } from '../../common/enums/report-status.enum.js';
import { Role } from '../../common/enums/role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import { AuditAction, AuditResourceType } from './audit-action.enum.js';
import { AuditEntryRejected, type AuditRejectionReason } from './audit.errors.js';

/*
 * Formatos de metadata por ação (AUDIT-05, D45). Só tipos restritos: UUID, enums, inteiros não negativos, datas ISO,
 * booleanos e códigos fechados. Nunca `text()` nem `z.string()` livre: a trilha é permanente e não pode guardar texto.
 */
const count = () => z.int().nonnegative();
const numericId = () => z.string().regex(/^\d{1,19}$/);
const isoDate = () => z.iso.datetime({ offset: true });
const none = () => z.strictObject({}).optional();

export const AUDIT_RESOURCE_ID = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);

const auditLogFilters = z.strictObject({
  actorUserId: z.uuid().optional(),
  action: z.enum(AuditAction).optional(),
  resourceType: z.enum(AuditResourceType).optional(),
  resourceId: AUDIT_RESOURCE_ID.optional(),
  from: isoDate().optional(),
  to: isoDate().optional(),
});

const SPECIFIC: Partial<Record<AuditAction, z.ZodType>> = {
  [AuditAction.USER_CREATED]: z.strictObject({ roles: z.array(z.enum(Role)).max(5), forced: z.boolean() }),
  [AuditAction.USER_ROLES_CHANGED]: z.strictObject({
    before: z.array(z.enum(Role)).max(5),
    after: z.array(z.enum(Role)).max(5),
  }),
  [AuditAction.USER_STATUS_CHANGED]: z.strictObject({ from: z.enum(UserStatus), to: z.enum(UserStatus) }),
  [AuditAction.REPORT_STATUS_CHANGED]: z.strictObject({
    from: z.enum(ReportStatus),
    to: z.enum(ReportStatus),
    outcome: z.enum(ReportOutcome).optional(),
  }),
  [AuditAction.REPORT_PRIORITY_CHANGED]: z.strictObject({ from: z.enum(Priority).optional(), to: z.enum(Priority) }),
  [AuditAction.REPORT_ASSIGNED]: z.strictObject({ userId: z.uuid() }),
  [AuditAction.REPORT_UNASSIGNED]: z.strictObject({ userId: z.uuid() }),
  [AuditAction.REPORT_LIST_VIEWED]: z.strictObject({
    filters: z.strictObject({
      status: z.enum(ReportStatus).optional(),
      categoryId: z.uuid().optional(),
      assignedToId: z.uuid().optional(),
    }),
    count: count(),
  }),
  [AuditAction.SETTING_UPDATED]: z.strictObject({ key: z.string().regex(/^[a-zA-Z0-9_.]{1,80}$/) }),
  [AuditAction.ACCESS_DENIED]: z.strictObject({ required: z.enum(Role).optional() }).optional(),
  [AuditAction.KEYS_REWRAPPED]: z.strictObject({
    latestVersion: count(),
    batch: count(),
    rewrapped: count(),
    skipped: count(),
  }),
  [AuditAction.KEYS_REWRAP_RUN]: z.strictObject({
    latestVersion: count(),
    batches: count(),
    rewrapped: count(),
    skipped: count(),
    failed: count(),
  }),
  [AuditAction.AUDIT_LOG_VIEWED]: z.strictObject({ filters: auditLogFilters, count: count() }),
  [AuditAction.AUDIT_CHAIN_VERIFIED]: z.strictObject({
    ok: z.boolean(),
    checked: count(),
    firstBrokenId: numericId().optional(),
    anchored: z.boolean(),
  }),
  [AuditAction.AUDIT_LOG_PURGED]: z.strictObject({
    partition: z.string().regex(/^audit_logs_\d{4}_\d{2}$/),
    purgedThrough: isoDate(),
    rowsRemoved: count(),
    anchorAuditId: numericId().optional(),
  }),
};

/** Schema de cada ação. Ação sem formato próprio não aceita nenhum campo (até a feature dela definir um). */
export const AUDIT_METADATA_SCHEMAS = Object.fromEntries(
  Object.values(AuditAction).map((action) => [action, SPECIFIC[action] ?? none()]),
) as Record<AuditAction, z.ZodType>;

export type AuditMetadata = Record<string, unknown>;

/** Converte as issues do zod em motivos sem valor nem nome de chave recebida (como na feature 001). */
export function toRejectionReasons(issues: readonly z.core.$ZodIssue[]): AuditRejectionReason[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.code === 'unrecognized_keys' ? issue.path.join('.') : issue.path.map(String).join('.'),
  }));
}

/** Valida a metadata pelo schema da ação. Lança `AuditEntryRejected` sem ecoar nada do que foi recebido. */
export function validateAuditMetadata(action: AuditAction, metadata: unknown): AuditMetadata | null {
  const result = AUDIT_METADATA_SCHEMAS[action].safeParse(metadata);
  if (!result.success) throw new AuditEntryRejected(toRejectionReasons(result.error.issues));
  return (result.data as AuditMetadata | undefined) ?? null;
}
