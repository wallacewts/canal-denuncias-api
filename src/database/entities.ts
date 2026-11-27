import { Attachment } from '../modules/attachments/entities/attachment.entity.js';
import { AuditLog } from '../modules/audit/entities/audit-log.entity.js';
import { RecoveryCode } from '../modules/auth/entities/recovery-code.entity.js';
import { Session } from '../modules/auth/entities/session.entity.js';
import { InternalNote } from '../modules/case-management/entities/internal-note.entity.js';
import { ReportAccessBlock } from '../modules/case-management/entities/report-access-block.entity.js';
import { ReportAssignment } from '../modules/case-management/entities/report-assignment.entity.js';
import { ReportStatusHistory } from '../modules/case-management/entities/report-status-history.entity.js';
import { Category } from '../modules/catalog/entities/category.entity.js';
import { Setting } from '../modules/catalog/entities/setting.entity.js';
import { IdentityRevealRequest } from '../modules/identity-vault/entities/identity-reveal-request.entity.js';
import { ReporterIdentity } from '../modules/identity-vault/entities/reporter-identity.entity.js';
import { Message } from '../modules/messages/entities/message.entity.js';
import { Report } from '../modules/reports/entities/report.entity.js';
import { UserRole } from '../modules/users/entities/user-role.entity.js';
import { User } from '../modules/users/entities/user.entity.js';

/**
 * Lista única de entidades, usada pela API e pela CLI de migrations.
 * Lista explícita (e não glob) para funcionar igual no build, no Vitest e na CLI.
 * Toda entidade nova precisa entrar aqui.
 */
export const ENTITIES = [
  User,
  UserRole,
  RecoveryCode,
  Session,
  Category,
  Setting,
  Report,
  ReporterIdentity,
  IdentityRevealRequest,
  ReportStatusHistory,
  ReportAssignment,
  ReportAccessBlock,
  InternalNote,
  Message,
  Attachment,
  AuditLog,
];
