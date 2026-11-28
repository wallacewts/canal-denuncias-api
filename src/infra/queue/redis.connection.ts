import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.schema.js';

/** Cliente Redis para o BullMQ. `maxRetriesPerRequest: null` é exigido pelos workers do BullMQ. */
export function createRedisClient(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

/**
 * Conexão Redis compartilhada pelas filas. Em ESM nativo o BullMQ 6 exige um cliente já construído, em vez de
 * opções de conexão. Os workers recebem cópias dedicadas (`duplicate()`), feitas pelo próprio BullMQ.
 */
@Injectable()
export class RedisConnection implements OnApplicationShutdown {
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = createRedisClient(config.get('REDIS_URL', { infer: true }));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
