import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';

/** Números do limite de tentativas do login (feature 006, R4), vindos do ambiente. */
export interface AuthRateLimits {
  /** Prefixo das chaves no Redis (isola instalações e suítes de teste). */
  prefix: string;
  ip: { limit: number; ttlMs: number };
  account: { limit: number; ttlMs: number };
}

export const AUTH_RATE_LIMITS = Symbol('AUTH_RATE_LIMITS');

export function rateLimitsFromEnv(config: Pick<ConfigService<Env, true>, 'get'>): AuthRateLimits {
  return {
    prefix: 'auth',
    ip: {
      limit: config.get('AUTH_RATE_LIMIT_IP_LIMIT', { infer: true }),
      ttlMs: config.get('AUTH_RATE_LIMIT_IP_WINDOW_SECONDS', { infer: true }) * 1000,
    },
    account: {
      limit: config.get('AUTH_RATE_LIMIT_ACCOUNT_LIMIT', { infer: true }),
      ttlMs: config.get('AUTH_RATE_LIMIT_ACCOUNT_WINDOW_SECONDS', { infer: true }) * 1000,
    },
  };
}
