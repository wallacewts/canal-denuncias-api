import { HMAC_PURPOSES, deriveHmacKeys, hmacHex } from './hmac-keys.js';

const SECRET = 'segredo-do-hmac-da-autenticacao-32-bytes';

describe('Chaves de HMAC por finalidade (feature 006, R4a)', () => {
  it('uma chave de 32 bytes por finalidade, diferentes entre si', () => {
    const keys = deriveHmacKeys({ AUTH_HMAC_SECRET: SECRET, SESSION_SECRET: 'x'.repeat(40) });
    expect(Object.keys(keys).sort()).toEqual([...HMAC_PURPOSES].sort());
    expect(keys['throttle-account']).toHaveLength(32);
    expect(keys['throttle-account'].equals(keys['session-public-id'])).toBe(false);
  });

  it('estáveis para o mesmo segredo e diferentes para outro', () => {
    const a = deriveHmacKeys({ AUTH_HMAC_SECRET: SECRET, SESSION_SECRET: 'x'.repeat(40) });
    const b = deriveHmacKeys({ AUTH_HMAC_SECRET: SECRET, SESSION_SECRET: 'y'.repeat(40) });
    const c = deriveHmacKeys({ AUTH_HMAC_SECRET: `${SECRET}-outro`, SESSION_SECRET: 'x'.repeat(40) });
    expect(a['throttle-account'].equals(b['throttle-account'])).toBe(true);
    expect(a['throttle-account'].equals(c['throttle-account'])).toBe(false);
  });

  it('sem AUTH_HMAC_SECRET (desenvolvimento e teste), deriva do SESSION_SECRET, sem igualar a ele', () => {
    const keys = deriveHmacKeys({ AUTH_HMAC_SECRET: undefined, SESSION_SECRET: 'z'.repeat(40) });
    expect(keys['session-public-id']).toHaveLength(32);
    expect(keys['session-public-id'].toString('utf8')).not.toContain('zzzz');
  });

  it('hmacHex não contém o valor de entrada', () => {
    const keys = deriveHmacKeys({ AUTH_HMAC_SECRET: SECRET, SESSION_SECRET: 'x'.repeat(40) });
    const out = hmacHex(keys['throttle-account'], 'ana.xqz@empresa.test');
    expect(out).toMatch(/^[0-9a-f]{64}$/);
    expect(out).not.toContain('xqz');
  });
});
