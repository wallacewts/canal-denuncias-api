import { randomUUID } from 'node:crypto';
import v8 from 'node:v8';
import vm from 'node:vm';
import request from 'supertest';
import { ActorType } from '../../src/common/enums/actor-type.enum.js';
import { AuditResult } from '../../src/common/enums/audit-result.enum.js';
import { Role } from '../../src/common/enums/role.enum.js';
import { computeAuditHash, GENESIS_HASH } from '../../src/modules/audit/audit-hash.js';
import { AuditVerifierService } from '../../src/modules/audit/audit-verifier.service.js';
import { withRole } from '../support/db-roles.js';
import { testIdentity } from '../support/fake-identity.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

const IN_CI = process.env.CI === 'true';
const INSERT_BATCH = 1000;
const COLUMNS = 8;

function placeholders(rowIndex: number): string {
  const base = rowIndex * COLUMNS;
  return `(${Array.from({ length: COLUMNS }, (_, i) => `$${base + i + 1}`).join(', ')})`;
}

/**
 * Desempenho da trilha (SC-006, SC-007). Os registros encadeados são inseridos direto no banco, sem passar pelo
 * serviço, para a preparação não levar minutos. Os limites de tempo valem só fora do CI; os valores são registrados.
 */
describe('Desempenho da verificação e da consulta (e2e)', () => {
  let t: TestApp;
  let prev = GENESIS_HASH;
  let seq = 0;

  async function insertChained(n: number): Promise<void> {
    await withRole(t.database, 'app_runtime', async (c) => {
      for (let done = 0; done < n; done += INSERT_BATCH) {
        const size = Math.min(INSERT_BATCH, n - done);
        const values: unknown[] = [];
        const tuples: string[] = [];
        for (let i = 0; i < size; i++) {
          seq += 1;
          const row = {
            occurredAt: new Date(Date.UTC(2026, 10, 1) + seq * 1000),
            actorType: ActorType.SYSTEM,
            actorUserId: null,
            action: seq % 10 === 0 ? 'REPORT_SHREDDED' : 'REPORT_VIEWED',
            resourceType: 'report',
            resourceId: `r${seq}`,
            result: AuditResult.SUCCESS,
            ip: null,
            userAgent: null,
            metadata: null,
          };
          const hash = computeAuditHash(prev, row);
          tuples.push(placeholders(i));
          values.push(
            row.occurredAt,
            row.actorType,
            row.action,
            row.resourceType,
            row.resourceId,
            row.result,
            prev,
            hash,
          );
          prev = hash;
        }
        await c.query(
          `INSERT INTO audit_logs (occurred_at, actor_type, action, resource_type, resource_id, result, prev_hash, hash)
           VALUES ${tuples.join(', ')}`,
          values,
        );
      }
    });
  }

  beforeAll(async () => {
    t = await createTestApp({ identity: true });
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  async function measure(): Promise<{ seconds: number; growthMb: number; checked: number }> {
    v8.setFlagsFromString('--expose-gc');
    // Como na 002: liberação síncrona dos ArrayBuffers, para a amostra medir só o que fica retido.
    v8.setFlagsFromString('--no-concurrent-array-buffer-sweeping');
    const gc = vm.runInNewContext('gc') as () => void;
    const usage = () => {
      const m = process.memoryUsage();
      return m.heapUsed + m.arrayBuffers;
    };
    gc();
    const baseline = usage();
    let peak = baseline;
    let batches = 0;
    const started = performance.now();
    const result = await t.app.get(AuditVerifierService).verify({
      onBatch: () => {
        if (++batches % 10 === 0) {
          gc();
          peak = Math.max(peak, usage());
        }
      },
    });
    const seconds = (performance.now() - started) / 1000;
    expect(result.ok).toBe(true);
    return { seconds, growthMb: (peak - baseline) / 1024 / 1024, checked: result.checked };
  }

  it('verifica 100.000 registros em menos de 1 minuto, com memória que não cresce com a trilha (SC-006)', async () => {
    await insertChained(10_000);
    const small = await measure();
    await insertChained(90_000);
    const large = await measure();
    console.info(
      `verificação: 10 mil em ${small.seconds.toFixed(2)} s (memória viva +${small.growthMb.toFixed(2)} MB); ` +
        `100 mil em ${large.seconds.toFixed(2)} s (memória viva +${large.growthMb.toFixed(2)} MB)`,
    );
    expect(large.checked).toBe(100_000);
    // Memória constante: 10x mais registros não podem reter proporcionalmente mais memória.
    expect(large.growthMb).toBeLessThan(Math.max(small.growthMb * 2, small.growthMb + 5));
    if (!IN_CI) expect(large.seconds).toBeLessThan(60);
  }, 300_000);

  it('a primeira página da consulta com filtro sai em menos de 1 segundo (SC-007)', async () => {
    const started = performance.now();
    const res = await request(t.app.getHttpServer())
      .get('/api/admin/v1/audit-logs')
      .query({ action: 'REPORT_SHREDDED', limit: '50' })
      .set(testIdentity(randomUUID(), Role.AUDITOR))
      .expect(200);
    const seconds = (performance.now() - started) / 1000;
    console.info(`consulta: primeira página com filtro em ${(seconds * 1000).toFixed(0)} ms`);
    expect(res.body.items).toHaveLength(50);
    if (!IN_CI) expect(seconds).toBeLessThan(1);
  });
});
