import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionService } from '@nestjs/authentication';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Env } from '../../config/env.schema.js';
import { HMAC_KEYS, hmacHex, type HmacKeys } from '../auth/hmac-keys.js';
import { RedisConnection } from '../queue/redis.connection.js';
import { AUTH_RATE_LIMITS, rateLimitsFromEnv, type AuthRateLimits } from './auth-rate-limits.js';
import { AuthThrottleGuard } from './auth-throttle.guard.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/** Configuração do limite (substituível nos testes) e o cliente Redis do limite. */
@Global()
@Module({
  providers: [
    {
      provide: AUTH_RATE_LIMITS,
      inject: [ConfigService],
      useFactory: (c: ConfigService<Env, true>) => rateLimitsFromEnv(c),
    },
    RedisConnection,
  ],
  exports: [AUTH_RATE_LIMITS, RedisConnection],
})
class ThrottleConfigModule {}

/**
 * Limite de tentativas em `sign-in` e `mfa/challenge` (AUTH-08, feature 006, R4), por IP e por conta. A conta é o
 * HMAC do e-mail normalizado (chave `throttle-account`) na entrada, e o HMAC do token da sessão pendente no desafio:
 * nada em claro no Redis, e o mesmo limite para e-mail existente ou não.
 */
@Module({
  imports: [
    ThrottleConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [AUTH_RATE_LIMITS, RedisConnection, HMAC_KEYS, SessionService],
      useFactory: (limits: AuthRateLimits, redis: RedisConnection, keys: HmacKeys, sessions: SessionService) => {
        const accountTracker = (
          req: Request & { body?: { email?: unknown } },
          context: { getHandler(): { name: string } },
        ) => {
          const key = keys['throttle-account'];
          if (context.getHandler().name === 'signIn') {
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            return hmacHex(key, `email:${email}`);
          }
          return hmacHex(key, `session:${sessions.tokenFrom(req) ?? ''}`);
        };
        return {
          throttlers: [
            {
              name: 'ip',
              limit: limits.ip.limit,
              ttl: limits.ip.ttlMs,
              getTracker: ((req: Request) => req.ip ?? 'sem-ip') as never,
            },
            {
              name: 'account',
              limit: limits.account.limit,
              ttl: limits.account.ttlMs,
              getTracker: accountTracker as never,
            },
          ],
          storage: new RedisThrottlerStorage(redis.client, limits.prefix),
          setHeaders: false,
        };
      },
    }),
  ],
  providers: [AuthThrottleGuard],
  exports: [AuthThrottleGuard, ThrottlerModule],
})
export class ThrottleModule {}
