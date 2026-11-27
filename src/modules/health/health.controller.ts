import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  /** Liveness: o processo está de pé. Não toca no banco. */
  @Get('health')
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  /** Readiness: consegue atender (banco acessível). Redis, storage e Vault entram junto com os módulos que os usam. */
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([() => this.db.pingCheck('database')]);
  }
}
