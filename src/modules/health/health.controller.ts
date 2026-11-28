import { Controller, Get } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { AuditPartitionsIndicator } from './audit-partitions.indicator.js';

/** Fora das duas áreas, sem credencial (o orquestrador chama sem sessão). */
@Public()
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly partitions: AuditPartitionsIndicator,
  ) {}

  /** Liveness: o processo está de pé. Não toca no banco. */
  @Get('health')
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  /**
   * Readiness: consegue atender (banco acessível e partições da trilha para o mês corrente e o seguinte). Redis,
   * storage e Vault entram junto com os módulos que os usam.
   */
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([() => this.db.pingCheck('database'), () => this.partitions.check()]);
  }
}
