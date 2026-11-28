import { Get, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AdminApi } from '../../src/common/http/route-decorators.js';
import { ExampleAuthModule } from '../contract/auth/example/example.module.js';
import { createTestApp } from '../support/test-app.js';
import { ANYONE_ALLOWED, adminRoutes, routeProblems } from './admin-route-checks.js';

/** Controller só deste teste, sem declaração: o teste de convenção precisa encontrá-lo e nomeá-lo. */
@AdminApi('convention-probe')
class UndeclaredProbeController {
  @Get()
  probe() {
    return { ok: true };
  }
}

@Module({ controllers: [UndeclaredProbeController] })
class UndeclaredProbeModule {}

/** O teste de convenção falha de verdade (US5, cenário 2): app separado, com rotas sem declaração. */
describe('Convenção: a varredura encontra e nomeia rota sem declaração (e2e)', () => {
  it('nomeia a rota sem declaração e o @Can.Anyone() fora da lista; o pacote também a lista no log', async () => {
    const t = await createTestApp({ imports: [DiscoveryModule, UndeclaredProbeModule, ExampleAuthModule] });
    try {
      const problems = routeProblems(adminRoutes(t.app), ANYONE_ALLOWED);
      expect(problems).toContain('GET /api/admin/v1/convention-probe: sem declaração de permissão');
      expect(problems).toContain('GET /api/admin/v1/example-admin/no-rule: sem declaração de permissão');
      expect(problems).toContain('GET /api/admin/v1/example-admin/reports/:id: @Can.Anyone() fora da lista');
      expect(problems).toContain(
        'GET /api/admin/v1/example-admin/manager-only: política ExamplePolicy fora do mapa de habilidades',
      );
      expect(t.logs.text()).toContain('UndeclaredProbeController.probe');
    } finally {
      await t.close();
    }
  }, 120_000);
});
