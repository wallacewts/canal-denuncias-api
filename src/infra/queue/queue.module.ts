import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DEFAULT_JOB_OPTIONS } from './job-defaults.js';
import { RedisConnection } from './redis.connection.js';

export const QUEUES = {
  /** E-mails internos sem conteúdo de denúncia (módulo notifications). */
  notifications: 'notifications',
  /** Expurgo e rewrap de chaves (módulos retention e crypto). Jobs agendados usam `upsertJobScheduler` (D30). */
  maintenance: 'maintenance',
} as const;

@Module({ providers: [RedisConnection], exports: [RedisConnection] })
class RedisConnectionModule {}

/** Conexão Redis compartilhada e filas com padrões seguros (TRV-05). */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [RedisConnectionModule],
      inject: [RedisConnection],
      useFactory: (redis: RedisConnection) => ({
        connection: redis.client,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue({ name: QUEUES.notifications }, { name: QUEUES.maintenance }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
