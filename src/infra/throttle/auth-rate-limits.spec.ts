import { rateLimitsFromEnv } from './auth-rate-limits.js';

describe('rateLimitsFromEnv (feature 006, R4)', () => {
  it('converte as janelas de segundos para milissegundos e mantém os limites', () => {
    const env: Record<string, number> = {
      AUTH_RATE_LIMIT_IP_LIMIT: 20,
      AUTH_RATE_LIMIT_IP_WINDOW_SECONDS: 60,
      AUTH_RATE_LIMIT_ACCOUNT_LIMIT: 10,
      AUTH_RATE_LIMIT_ACCOUNT_WINDOW_SECONDS: 900,
    };
    const limits = rateLimitsFromEnv({ get: (name: string) => env[name] } as never);
    expect(limits).toEqual({
      prefix: 'auth',
      ip: { limit: 20, ttlMs: 60_000 },
      account: { limit: 10, ttlMs: 900_000 },
    });
  });
});
