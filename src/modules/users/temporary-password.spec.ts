import { checkPasswordPolicy } from '../auth/password/password-policy.js';
import { TEMPORARY_PASSWORD_ALPHABET, generateTemporaryPassword } from './temporary-password.js';

describe('Senha provisória (feature 005, R5)', () => {
  it('tem 20 caracteres do alfabeto sem ambíguos', () => {
    const password = generateTemporaryPassword();
    expect(password).toHaveLength(20);
    for (const ch of password) expect(TEMPORARY_PASSWORD_ALPHABET).toContain(ch);
    for (const ambiguous of ['0', 'O', '1', 'l', 'I']) expect(TEMPORARY_PASSWORD_ALPHABET).not.toContain(ambiguous);
  });

  it('o alfabeto tem 56 símbolos distintos (≈116 bits em 20 caracteres)', () => {
    expect(new Set(TEMPORARY_PASSWORD_ALPHABET).size).toBe(56);
    expect(TEMPORARY_PASSWORD_ALPHABET).toHaveLength(56);
  });

  it('passa na política de senha', () => {
    for (let i = 0; i < 50; i++) expect(checkPasswordPolicy(generateTemporaryPassword()).ok).toBe(true);
  });

  it('1.000 gerações sem repetição', () => {
    const seen = new Set(Array.from({ length: 1_000 }, () => generateTemporaryPassword()));
    expect(seen.size).toBe(1_000);
  });
});
