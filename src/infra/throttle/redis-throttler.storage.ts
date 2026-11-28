import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

/** Incrementa e, no primeiro acerto, abre a janela; devolve acertos e tempo restante em ms. Atômico no Redis. */
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local pttl = redis.call('PTTL', KEYS[1])
if pttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); pttl = tonumber(ARGV[1]) end
return { hits, pttl }
`;

/**
 * Storage do `@nestjs/throttler` sobre o Redis da API (feature 006, R4): vale para todas as instâncias. A chave já
 * chega como hash do throttler (nenhum e-mail em claro); aqui só ganha o prefixo. O bloqueio dura até o fim da
 * janela.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  // O bloqueio vale até o fim da janela: a duração própria do bloqueio e o nome do throttler não mudam nada aqui.
  async increment(key: string, ttl: number, limit: number, _blockDuration?: number, _throttlerName?: string) {
    const [totalHits, pttl] = (await this.redis.eval(INCREMENT, 1, `throttle:${this.prefix}:${key}`, ttl)) as [
      number,
      number,
    ];
    const timeToExpire = Math.max(1, Math.ceil(pttl / 1000));
    const isBlocked = totalHits > limit;
    return { totalHits, timeToExpire, isBlocked, timeToBlockExpire: isBlocked ? timeToExpire : 0 };
  }
}
