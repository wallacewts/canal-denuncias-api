import { AUDIT_METADATA_SCHEMAS } from './audit-metadata.schemas.js';
import { AuditAction, AuditResourceType } from './audit-action.enum.js';

const AUDIT_01 = [
  'AUTH_SIGNED_IN',
  'AUTH_LOGIN_FAILED',
  'AUTH_SIGNED_OUT',
  'AUTH_MFA_ENROLLED',
  'AUTH_MFA_FAILED',
  'AUTH_RECOVERY_CODE_USED',
  'AUTH_PASSWORD_CHANGED',
  'AUTH_SESSION_REVOKED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_STATUS_CHANGED',
  'USER_ROLES_CHANGED',
  'USER_MFA_RESET',
  'ACCESS_DENIED',
  'CATEGORY_CREATED',
  'CATEGORY_UPDATED',
  'SETTING_UPDATED',
  'REPORT_CREATED',
  'REPORT_LIST_VIEWED',
  'REPORT_VIEWED',
  'REPORT_STATUS_CHANGED',
  'REPORT_PRIORITY_CHANGED',
  'REPORT_ASSIGNED',
  'REPORT_UNASSIGNED',
  'REPORT_ACCESS_BLOCKED',
  'REPORT_ACCESS_UNBLOCKED',
  'INTERNAL_NOTE_CREATED',
  'INTERNAL_NOTES_VIEWED',
  'REPORTER_ACCESS_GRANTED',
  'REPORTER_ACCESS_DENIED',
  'REPORTER_REPORT_VIEWED',
  'MESSAGE_SENT',
  'MESSAGES_VIEWED',
  'ATTACHMENT_UPLOADED',
  'ATTACHMENT_REJECTED',
  'ATTACHMENT_DOWNLOADED',
  'ATTACHMENT_INTEGRITY_FAILED',
  'IDENTITY_REVEAL_REQUESTED',
  'IDENTITY_REVEAL_APPROVED',
  'IDENTITY_REVEAL_REJECTED',
  'IDENTITY_REVEALED',
  'LEGAL_HOLD_CHANGED',
  'REPORT_SHREDDED',
  'RETENTION_RUN',
  'KEYS_REWRAPPED',
  'AUDIT_LOG_VIEWED',
  'AUDIT_CHAIN_VERIFIED',
  'REPORTING_VIEWED',
  'REPORTING_EXPORTED',
];

describe('Catálogo da auditoria (AUDIT-01, D45)', () => {
  const actions = Object.values(AuditAction);

  it('contém as ações da AUDIT-01, mais KEYS_REWRAP_RUN, AUDIT_LOG_PURGED e AUTH_PASSWORD_CHANGE_FAILED', () => {
    expect(new Set(actions).size).toBe(actions.length);
    const extra = ['KEYS_REWRAP_RUN', 'AUDIT_LOG_PURGED', 'AUTH_PASSWORD_CHANGE_FAILED'];
    expect(actions).toEqual(expect.arrayContaining([...AUDIT_01, ...extra]));
    expect(actions).toHaveLength(AUDIT_01.length + extra.length);
  });

  it('toda ação cabe em action varchar(60) e todo tipo de recurso em resource_type varchar(40)', () => {
    for (const action of actions) expect(action.length).toBeLessThanOrEqual(60);
    for (const type of Object.values(AuditResourceType)) expect(type.length).toBeLessThanOrEqual(40);
  });

  it('nomes de autenticação fixados pela D53: sem AUTH_TOKEN_REUSED, AUTH_LOGIN_SUCCEEDED nem AUTH_LOGOUT', () => {
    expect(actions).not.toContain('AUTH_TOKEN_REUSED');
    expect(actions).not.toContain('AUTH_LOGIN_SUCCEEDED');
    expect(actions).not.toContain('AUTH_LOGOUT');
  });

  it('toda ação tem um schema de metadata', () => {
    for (const action of actions) expect(AUDIT_METADATA_SCHEMAS[action]).toBeDefined();
  });
});
