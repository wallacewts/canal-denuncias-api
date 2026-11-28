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

  describe('ações de autenticação e acesso negado (feature 004, T006)', () => {
    it('aceitam só os formatos do contrato', () => {
      expect(() => validateAuditMetadata(AuditAction.AUTH_SIGNED_IN, { method: 'password' })).not.toThrow();
      expect(() => validateAuditMetadata(AuditAction.AUTH_SIGNED_OUT, undefined)).not.toThrow();
      expect(() => validateAuditMetadata(AuditAction.AUTH_MFA_FAILED, { locked: false })).not.toThrow();
      expect(() => validateAuditMetadata(AuditAction.AUTH_SESSION_REVOKED, { scope: 'all' })).not.toThrow();
      expect(() =>
        validateAuditMetadata(AuditAction.ACCESS_DENIED, { policy: 'ExamplePolicy', ability: 'treat' }),
      ).not.toThrow();
      expect(() => validateAuditMetadata(AuditAction.ACCESS_DENIED, { policy: null, ability: null })).not.toThrow();
    });

    it.each([SHORT, LONG])('recusam senha, código, token ou id de sessão na metadata, sem eco (%#)', (secret) => {
      for (const [action, metadata] of [
        [AuditAction.AUTH_SIGNED_IN, { method: 'password', password: secret }],
        [AuditAction.AUTH_SIGNED_IN, { method: secret }],
        [AuditAction.AUTH_MFA_FAILED, { code: secret }],
        [AuditAction.AUTH_SIGNED_OUT, { sessionId: secret }],
        [AuditAction.AUTH_SESSION_REVOKED, { token: secret }],
        [AuditAction.ACCESS_DENIED, { policy: secret.repeat(30), ability: 'read' }],
        [AuditAction.ACCESS_DENIED, { policy: 'ExamplePolicy', ability: 'read', user: secret }],
      ] as const) {
        const error = rejection(action, metadata);
        expect(JSON.stringify(error)).not.toContain(secret);
        expect(error.message).not.toContain(secret);
      }
    });
  });

  describe('ações da equipe (feature 005, T009)', () => {
    it('USER_CREATED aceita forced ausente (cadastro pela API) e presente (create-admin)', () => {
      expect(() => validateAuditMetadata(AuditAction.USER_CREATED, { roles: [Role.ANALYST] })).not.toThrow();
      expect(() =>
        validateAuditMetadata(AuditAction.USER_CREATED, { roles: [Role.ADMIN], forced: true }),
      ).not.toThrow();
    });

    it('USER_UPDATED aceita só o nome do campo alterado, nunca o valor', () => {
      expect(() => validateAuditMetadata(AuditAction.USER_UPDATED, { fields: ['name'] })).not.toThrow();
      rejection(AuditAction.USER_UPDATED, { fields: ['name'], name: SHORT });
      rejection(AuditAction.USER_UPDATED, { fields: ['email'] });
      rejection(AuditAction.USER_UPDATED, { fields: [] });
      rejection(AuditAction.USER_UPDATED, undefined);
    });

    it('USER_MFA_RESET não aceita nenhum campo', () => {
      expect(() => validateAuditMetadata(AuditAction.USER_MFA_RESET, undefined)).not.toThrow();
      rejection(AuditAction.USER_MFA_RESET, { secret: SHORT });
    });
  });

  describe('ações do login da equipe (feature 006, T006)', () => {
    it('aceitam só os formatos do contrato', () => {
      for (const reason of ['UNKNOWN_ACCOUNT', 'BAD_CREDENTIALS', 'TEMPORARILY_LOCKED', 'BLOCKED', 'DISABLED']) {
        expect(() => validateAuditMetadata(AuditAction.AUTH_LOGIN_FAILED, { reason })).not.toThrow();
      }
      expect(() =>
        validateAuditMetadata(AuditAction.AUTH_LOGIN_FAILED, { reason: 'BAD_CREDENTIALS', locked: true }),
      ).not.toThrow();
      expect(() => validateAuditMetadata(AuditAction.AUTH_MFA_ENROLLED, { replaced: false })).not.toThrow();
      expect(() => validateAuditMetadata(AuditAction.AUTH_RECOVERY_CODE_USED, undefined)).not.toThrow();
      expect(() => validateAuditMetadata(AuditAction.AUTH_PASSWORD_CHANGED, undefined)).not.toThrow();
      expect(() =>
        validateAuditMetadata(AuditAction.AUTH_PASSWORD_CHANGE_FAILED, {
          reason: 'CURRENT_PASSWORD_INVALID',
          attempt: 5,
          locked: true,
        }),
      ).not.toThrow();
    });

    it('recusam texto livre, e-mail, senha e tentativas fora da faixa', () => {
      rejection(AuditAction.AUTH_LOGIN_FAILED, { reason: SHORT });
      rejection(AuditAction.AUTH_LOGIN_FAILED, { reason: 'BAD_CREDENTIALS', email: SHORT });
      rejection(AuditAction.AUTH_LOGIN_FAILED, undefined);
      rejection(AuditAction.AUTH_PASSWORD_CHANGE_FAILED, {
        reason: 'CURRENT_PASSWORD_INVALID',
        attempt: 6,
        locked: true,
      });
      rejection(AuditAction.AUTH_PASSWORD_CHANGE_FAILED, {
        reason: 'CURRENT_PASSWORD_INVALID',
        attempt: 0,
        locked: false,
      });
      rejection(AuditAction.AUTH_PASSWORD_CHANGE_FAILED, {
        reason: 'CURRENT_PASSWORD_INVALID',
        attempt: 1,
        locked: false,
        password: SHORT,
      });
      rejection(AuditAction.AUTH_RECOVERY_CODE_USED, { code: SHORT });
      rejection(AuditAction.AUTH_MFA_ENROLLED, { replaced: false, secret: SHORT });
    });
  });
});
