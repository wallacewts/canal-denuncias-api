import {
  challengeSchema,
  confirmationResponseSchema,
  enrollmentResponseSchema,
  enrollmentConfirmationSchema,
  ownSessionSchema,
  passwordChangeSchema,
  signInSchema,
  stepResponseSchema,
} from './auth.schemas.js';

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  JSON.stringify(r.error?.issues.map((i) => i.message) ?? []);

describe('Schemas do login (feature 006, T012)', () => {
  it('entrada: e-mail com espaços normalizado; campos extras recusados sem eco', () => {
    expect(signInSchema.parse({ email: '  ana@x.test ', password: 'p' })).toEqual({
      email: 'ana@x.test',
      password: 'p',
    });
    for (const input of [
      { email: 'a@x.test', password: 'p', otp: 'XQZ' },
      { email: '', password: 'p' },
      { email: 'a@x.test' },
    ]) {
      const r = signInSchema.safeParse(input);
      expect(r.success).toBe(false);
      expect(messages(r)).not.toContain('XQZ');
    }
  });

  it('desafio: exatamente um de code e recoveryCode', () => {
    expect(challengeSchema.parse({ code: '123456' })).toEqual({ code: '123456' });
    expect(challengeSchema.parse({ recoveryCode: 'abcd-efgh' })).toEqual({ recoveryCode: 'abcd-efgh' });
    expect(challengeSchema.safeParse({ code: '1', recoveryCode: '2' }).success).toBe(false);
    expect(challengeSchema.safeParse({}).success).toBe(false);
    expect(challengeSchema.safeParse({ code: '' }).success).toBe(false);
    expect(challengeSchema.safeParse({ code: '1'.repeat(17) }).success).toBe(false);
  });

  it('confirmação e troca de senha: campos obrigatórios e limites', () => {
    expect(enrollmentConfirmationSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(enrollmentConfirmationSchema.safeParse({ code: '123456', secret: 'XQZ' }).success).toBe(false);
    expect(passwordChangeSchema.safeParse({ currentPassword: 'a', newPassword: 'b' }).success).toBe(true);
    expect(passwordChangeSchema.safeParse({ currentPassword: '', newPassword: 'b' }).success).toBe(false);
    expect(passwordChangeSchema.safeParse({ currentPassword: 'a', newPassword: 'x'.repeat(257) }).success).toBe(false);
  });

  it('respostas: objetos fechados no formato do contrato do front', () => {
    const expiry = { idleExpiresAt: '2026-11-28T12:15:00.000Z', absoluteExpiresAt: '2026-11-28T20:00:00.000Z' };
    expect(stepResponseSchema.safeParse({ nextStep: 'DONE', ...expiry }).success).toBe(true);
    expect(stepResponseSchema.safeParse({ nextStep: 'DONE', ...expiry, extra: 1 }).success).toBe(false);
    expect(stepResponseSchema.safeParse({ nextStep: 'XQZ', ...expiry }).success).toBe(false);
    expect(
      enrollmentResponseSchema.safeParse({
        otpauthUri: 'otpauth://totp/x',
        qrCodeDataUri: 'data:image/png;base64,iVBOR',
        secret: 'ABC',
      }).success,
    ).toBe(true);
    expect(
      enrollmentResponseSchema.safeParse({
        otpauthUri: 'otpauth://totp/x',
        qrCodeDataUri: 'data:image/svg+xml;base64,PHN2',
        secret: 'ABC',
      }).success,
    ).toBe(false);
    const codes = Array.from({ length: 10 }, (_, i) => `code-${i}`);
    expect(confirmationResponseSchema.safeParse({ recoveryCodes: codes, nextStep: 'DONE', ...expiry }).success).toBe(
      true,
    );
    expect(
      confirmationResponseSchema.safeParse({ recoveryCodes: codes.slice(1), nextStep: 'DONE', ...expiry }).success,
    ).toBe(false);
    expect(
      ownSessionSchema.safeParse({
        id: 'a'.repeat(32),
        createdAt: expiry.idleExpiresAt,
        lastActiveAt: expiry.idleExpiresAt,
        ip: null,
        userAgent: null,
        current: true,
      }).success,
    ).toBe(true);
  });
});
