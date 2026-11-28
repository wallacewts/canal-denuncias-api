import { randomUUID } from 'node:crypto';
import { Role } from '../../common/enums/role.enum.js';
import { AuditAction } from './audit-action.enum.js';
import { AuditEntryRejected } from './audit.errors.js';
import { validateAuditMetadata } from './audit-metadata.schemas.js';

const SHORT = 'XQZ';
const LONG = 'relato sigiloso '.repeat(40);

function rejection(action: AuditAction, metadata: unknown): AuditEntryRejected {
  try {
    validateAuditMetadata(action, metadata);
  } catch (error) {
    expect(error).toBeInstanceOf(AuditEntryRejected);
    return error as AuditEntryRejected;
  }
  throw new Error('deveria ter recusado');
}

describe('Metadata por ação (AUDIT-05, D45)', () => {
  it('aceita os formatos já gravados hoje (FR-006)', () => {
    expect(() => validateAuditMetadata(AuditAction.USER_CREATED, { roles: [Role.ADMIN], forced: false })).not.toThrow();
    expect(() =>
      validateAuditMetadata(AuditAction.KEYS_REWRAPPED, { latestVersion: 3, batch: 1, rewrapped: 10, skipped: 0 }),
    ).not.toThrow();
    expect(() =>
      validateAuditMetadata(AuditAction.KEYS_REWRAP_RUN, {
        latestVersion: 3,
        batches: 2,
        rewrapped: 10,
        skipped: 1,
        failed: 0,
      }),
    ).not.toThrow();
  });

  it('aceita ação sem metadata quando o formato não prevê campos', () => {
    expect(() => validateAuditMetadata(AuditAction.REPORT_VIEWED, undefined)).not.toThrow();
    expect(() => validateAuditMetadata(AuditAction.REPORT_VIEWED, {})).not.toThrow();
  });

  it.each([
    ['campo não previsto curto', { roles: [Role.ADMIN], forced: false, texto: SHORT }],
    ['campo não previsto longo', { roles: [Role.ADMIN], forced: false, texto: LONG }],
    ['valor de enum desconhecido', { roles: [SHORT], forced: false }],
    ['tipo errado', { roles: [Role.ADMIN], forced: SHORT }],
  ])('recusa %s sem repetir o valor nem o nome da chave recebida', (_caso, metadata) => {
    const error = rejection(AuditAction.USER_CREATED, metadata);
    const serialized = JSON.stringify({ message: error.message, reasons: error.reasons });
    expect(serialized).not.toContain(SHORT);
    expect(serialized).not.toContain('relato sigiloso');
    expect(serialized).not.toContain('texto');
    expect(error.message).toBe('Registro de auditoria recusado.');
    expect(error.cause).toBeUndefined();
  });

  it('recusa texto livre mesmo numa ação sem campos previstos', () => {
    const error = rejection(AuditAction.REPORT_VIEWED, { nota: SHORT });
    expect(JSON.stringify(error.reasons)).not.toContain(SHORT);
  });

  it('recusa UUID inválido onde o formato pede UUID', () => {
    rejection(AuditAction.REPORT_ASSIGNED, { userId: SHORT });
    expect(() => validateAuditMetadata(AuditAction.REPORT_ASSIGNED, { userId: randomUUID() })).not.toThrow();
  });
});
