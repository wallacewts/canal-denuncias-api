import { createHmac, hkdfSync } from 'node:crypto';

/** Finalidades das chaves de HMAC do login (feature 006, R4a). Uma chave nunca serve a duas finalidades. */
export const HMAC_PURPOSES = ['throttle-account', 'session-public-id'] as const;
export type HmacPurpose = (typeof HMAC_PURPOSES)[number];
export type HmacKeys = Readonly<Record<HmacPurpose, Buffer>>;

export const HMAC_KEYS = Symbol('HMAC_KEYS');

/**
 * Deriva uma chave de 32 bytes por finalidade com HKDF-SHA-256. Em produção o segredo é o `AUTH_HMAC_SECRET`
 * (obrigatório, validado no schema); fora dela, sem ele, parte do `SESSION_SECRET` com uma finalidade própria, para
 * não haver segredo fixo no código.
 */
export function deriveHmacKeys(env: { AUTH_HMAC_SECRET?: string; SESSION_SECRET: string }): HmacKeys {
  const root = env.AUTH_HMAC_SECRET
    ? Buffer.from(env.AUTH_HMAC_SECRET, 'utf8')
    : Buffer.from(hkdfSync('sha256', env.SESSION_SECRET, '', 'auth-hmac-root', 32));
  const entries = HMAC_PURPOSES.map((purpose) => [purpose, Buffer.from(hkdfSync('sha256', root, '', purpose, 32))]);
  return Object.freeze(Object.fromEntries(entries)) as HmacKeys;
}

export function hmacHex(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}
