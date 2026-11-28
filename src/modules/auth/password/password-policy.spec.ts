import { checkPasswordPolicy, MIN_PASSWORD_LENGTH } from './password-policy.js';

describe('política de senha', () => {
  it('exige no mínimo 12 caracteres', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(checkPasswordPolicy('abcdefghijk')).toMatchObject({ ok: false, reason: 'too_short' });
    expect(checkPasswordPolicy('')).toMatchObject({ ok: false, reason: 'too_short' });
    expect(checkPasswordPolicy('x')).toMatchObject({ ok: false, reason: 'too_short' });
  });

  it('conta caracteres, não bytes (acentos e emoji contam um cada)', () => {
    expect(checkPasswordPolicy('çãéíóú😀çãéí')).toMatchObject({ ok: false, reason: 'too_short' });
    expect(checkPasswordPolicy('çãéíóú😀çãéíó').ok).toBe(true);
  });

  it.each(['password1234', 'PASSWORD1234', 'Senha1234567', 'administrador', '123456789012'])(
    'recusa a senha comum %s, sem diferenciar maiúsculas',
    (password) => {
      expect(checkPasswordPolicy(password)).toMatchObject({ ok: false, reason: 'common' });
    },
  );

  it('recusa senha acima de 128 caracteres', () => {
    expect(checkPasswordPolicy('a'.repeat(129))).toMatchObject({ ok: false, reason: 'too_long' });
  });

  it('aceita uma frase-senha longa e incomum', () => {
    expect(checkPasswordPolicy('cavalo bateria grampo correto 42')).toEqual({ ok: true });
  });

  it('a mensagem de recusa nunca repete a senha', () => {
    for (const password of ['curta', 'password1234', 'a'.repeat(200)]) {
      const result = checkPasswordPolicy(password);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).not.toContain(password.slice(0, 5));
    }
  });
});
