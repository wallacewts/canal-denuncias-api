import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';

/** Health checks para o Docker e o orquestrador. */
@Module({
  imports: [TerminusModule.forRoot({ gracefulShutdownTimeoutMs: 1000 })],
  controllers: [HealthController],
})
export class HealthModule {}
