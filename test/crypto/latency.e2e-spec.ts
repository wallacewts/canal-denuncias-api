import { DataKeyService } from '../../src/modules/crypto/data-key.service.js';
import { encryptionContext } from '../../src/modules/crypto/encryption-context.js';
import { RecordCipher } from '../../src/modules/crypto/record-cipher.service.js';
import { newRecordId } from '../../src/modules/crypto/record-id.js';
import { ReportContentV1Schema, type ReportContentV1 } from '../../src/modules/reports/report-content.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

const RUNS = 50;
const P95_LIMIT_MS = 100;

/**
 * SC-003 / D41: tempo de selar e abrir o conteúdo de uma denúncia, incluindo abrir a DEK no Vault local, com o AppRole
 * `api`. O p95 é sempre registrado; o limite de 100 ms só vale fora do CI (o Vault em container do CI varia mais).
 */
describe('Latência de selar e abrir uma denúncia (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ vault: 'api' });
  });

  afterAll(async () => {
    await t.close();
  });

  it(`p95 de ${RUNS} execuções`, async ({ annotate }) => {
    const keys = t.app.get(DataKeyService);
    const rc = t.app.get(RecordCipher);
    const ctx = encryptionContext('reports.content_enc', newRecordId());
    const content: ReportContentV1 = { v: 1, description: 'relato de teste de latência '.repeat(40) };
    const { wrapped } = await keys.createReportKey(() => undefined);

    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      await keys.withReportKey(wrapped, (dek) => {
        const sealed = rc.sealJson(dek, ctx, content);
        rc.openJson(dek, ctx, sealed, { 1: ReportContentV1Schema });
      });
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(RUNS * 0.95) - 1];
    const message = `p95 de selar e abrir uma denúncia: ${p95.toFixed(1)} ms (mediana ${times[RUNS / 2].toFixed(1)} ms)`;
    await annotate(message);
    console.info(message);

    if (!process.env.CI) expect(p95).toBeLessThan(P95_LIMIT_MS);
  });
});
