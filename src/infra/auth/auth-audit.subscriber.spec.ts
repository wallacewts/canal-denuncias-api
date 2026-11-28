import type { AuthenticationEvent } from '@nestjs/authentication';
import { AuditAction } from '../../modules/audit/audit-action.enum.js';
import { toAuditEntries, toAuditEntry } from './auth-audit.subscriber.js';

const USER = '01900000-0000-7000-8000-000000000001';
const actions = (event: AuthenticationEvent) => toAuditEntries(event).map((e) => [e.action, e.metadata ?? null]);

describe('Mapeamento de eventos de autenticação para a trilha (features 004 e 006)', () => {
  it('senha com segundo fator pendente não é login; o MFA aceito é', () => {
    expect(actions({ type: 'sign-in', userId: USER, method: 'password', mfa: 'pending' } as never)).toEqual([]);
    expect(actions({ type: 'mfa-verified', userId: USER, method: 'totp' })).toEqual([
      [AuditAction.AUTH_SIGNED_IN, { method: 'password' }],
    ]);
  });

  it('senha sem autenticador ainda não é login', () => {
    expect(actions({ type: 'sign-in', userId: USER, method: 'password' } as never)).toEqual([]);
  });

  it('código de recuperação aceito: login e uso do código', () => {
    expect(actions({ type: 'mfa-verified', userId: USER, method: 'recovery-code' })).toEqual([
      [AuditAction.AUTH_SIGNED_IN, { method: 'password' }],
      [AuditAction.AUTH_RECOVERY_CODE_USED, null],
    ]);
  });

  it('cadastro confirmado: só o cadastro (o login do primeiro acesso é registrado pelo serviço de cadastro)', () => {
    expect(actions({ type: 'mfa-enabled', userId: USER, replaced: false })).toEqual([
      [AuditAction.AUTH_MFA_ENROLLED, { replaced: false }],
    ]);
    expect(actions({ type: 'mfa-enabled', userId: USER, replaced: true })).toEqual([
      [AuditAction.AUTH_MFA_ENROLLED, { replaced: true }],
    ]);
  });

  it('falha de MFA, saída e saída de todos os lugares continuam como na feature 004', () => {
    expect(actions({ type: 'mfa-failed', userId: USER, method: 'totp', locked: true } as never)).toEqual([
      [AuditAction.AUTH_MFA_FAILED, { locked: true }],
    ]);
    expect(actions({ type: 'sign-out', userId: USER } as never)).toEqual([[AuditAction.AUTH_SIGNED_OUT, null]]);
    expect(actions({ type: 'sign-out', userId: USER, everywhere: true } as never)).toEqual([
      [AuditAction.AUTH_SESSION_REVOKED, { scope: 'all' }],
    ]);
  });

  it('toAuditEntry devolve o primeiro registro (o login, quando há), para o último login', () => {
    expect(toAuditEntry({ type: 'mfa-verified', userId: USER, method: 'recovery-code' })?.action).toBe(
      AuditAction.AUTH_SIGNED_IN,
    );
    expect(toAuditEntry({ type: 'mfa-disabled', userId: USER })).toBeNull();
  });
});
