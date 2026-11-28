import { DiscoveryModule } from '@nestjs/core';
import { createTestApp } from '../support/test-app.js';
import { ANYONE_ALLOWED, adminRoutes, routeProblems } from './admin-route-checks.js';

/** Convenção do ACL-05 (US5, FR-021, SC-004) sobre o app completo, sem fixtures. */
describe('Convenção: toda rota administrativa declara permissão (e2e)', () => {
  it('nenhuma rota sem declaração, @Can.Anyone() só na lista, nada no log da inicialização', async () => {
    const t = await createTestApp({ imports: [DiscoveryModule] });
    try {
      const routes = adminRoutes(t.app);
      expect(routes.length).toBeGreaterThan(10);
      expect(routeProblems(routes, ANYONE_ALLOWED)).toEqual([]);
      // A lista não guarda rota que já não existe.
      const keys = new Set(routes.map((r) => r.key));
      for (const key of Object.keys(ANYONE_ALLOWED)) expect(keys, key).toContain(key);
      expect(t.logs.text()).not.toContain('declare no check');
      expect(t.logs.text()).not.toContain('declares no check');
    } finally {
      await t.close();
    }
  }, 120_000);
});
