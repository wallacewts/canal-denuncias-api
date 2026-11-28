import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { createBareReport } from '../support/factories.js';
import { ReportAccessFixtureModule } from '../support/fixtures/report-access-fixture.module.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import { createUsersApp, staffWithSession, type StaffSession } from '../users/support.js';

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * SC-006 da feature 007 (D59): "existe fora do escopo" e "id inexistente" levam o mesmo tempo — a mesma consulta e a
 * mesma escrita na trilha. Diferença das medianas menor que 10% da menor mediana, com piso de 1 ms, em 40 amostras
 * alternadas. Roda isolado (`npm run test:timing`), sem outras suítes disputando a máquina.
 */
describe('Denúncia por id: tempo igual para fora do escopo e inexistente (timing)', () => {
  let t: TestApp & { clock: TestClock };
  let analyst: StaffSession;
  let hidden: string[];

  beforeAll(async () => {
    t = await createUsersApp(undefined, { imports: [ReportAccessFixtureModule] });
    const ds = t.app.get(DataSource);
    analyst = await staffWithSession(t, Role.ANALYST);
    const other = await staffWithSession(t, Role.ANALYST);
    hidden = [];
    for (let i = 0; i < 40; i++) hidden.push((await createBareReport(ds, { assignedToId: other.id })).id);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('diferença das medianas < 10% da menor (piso de 1 ms)', async () => {
    const SAMPLES = 40;
    const time = async (id: string) => {
      const start = performance.now();
      await request(t.app.getHttpServer())
        .get(`/api/admin/v1/report-access-fixture/${id}`)
        .set('Cookie', analyst.cookie)
        .expect(404);
      return performance.now() - start;
    };
    // Aquecimento: a primeira requisição de cada caminho paga a compilação dos planos.
    await time(hidden[0]);
    await time(randomUUID());
    const outOfScope: number[] = [];
    const notFound: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      if (i % 2 === 0) {
        outOfScope.push(await time(hidden[i]));
        notFound.push(await time(randomUUID()));
      } else {
        notFound.push(await time(randomUUID()));
        outOfScope.push(await time(hidden[i]));
      }
    }
    const [a, b] = [median(outOfScope), median(notFound)];
    const diff = Math.abs(a - b);
    const limit = Math.max(1, Math.min(a, b) * 0.1);
    process.stderr.write(
      `SC-006 (007): fora do escopo ${a.toFixed(2)} ms, inexistente ${b.toFixed(2)} ms, ` +
        `diferença ${diff.toFixed(2)} ms, limite ${limit.toFixed(2)} ms\n`,
    );
    expect(diff).toBeLessThan(limit);
  }, 120_000);
});
