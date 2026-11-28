import request from 'supertest';
import { DataSource } from 'typeorm';
import { DataKeyService } from '../../src/modules/crypto/data-key.service.js';
import { RecordCipher } from '../../src/modules/crypto/record-cipher.service.js';
import { createEncryptedReport, cryptoDeps, type CryptoDeps } from '../support/factories.js';
import { CryptoFixtureModule, type CryptoFailureMode } from '../support/fixtures/crypto-fixture.module.js';
import { Role } from '../../src/common/enums/role.enum.js';
import { testIdentity } from '../support/fake-identity.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Membro da equipe simulado: a área admin exige identidade (D47). */
const STAFF = testIdentity('0190a6e2-7c1b-7d3e-9f00-1a2b3c4d5e6f', Role.COMPLIANCE_MANAGER);

const RELATOS: Array<[string, string]> = [
  ['curto', 'XQZ'],
  ['longo', 'RELATO-LONGO-QUE-NAO-PODE-VAZAR '.repeat(60)],
];

const MODOS: Array<[CryptoFailureMode, number]> = [
  ['wrong-context', 500],
  ['tampered', 500],
  ['unknown-version', 500],
  ['bad-schema', 500],
  ['corrupted-dek', 500],
  ['vault-down', 503],
];

/** CRYPTO-08 / US5: falhas forçadas de criptografia nunca vazam relato, DEK nem valor cifrado (resposta e log). */
describe('Não vazamento nas falhas de criptografia (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;
  let deps: CryptoDeps;

  beforeAll(async () => {
    t = await createTestApp({ vault: 'api', imports: [CryptoFixtureModule], identity: true });
    ds = t.app.get(DataSource);
    deps = cryptoDeps(t.app);
  });

  afterAll(async () => {
    await t.close();
  });

  /** Formas em que um segredo poderia aparecer escrito. */
  function forms(value: Buffer | string): string[] {
    const b = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
    return [b.toString('utf8'), b.toString('base64'), b.toString('hex')].filter((s) => s.length >= 3);
  }

  it('a rota de fixture abre a denúncia quando nada está errado', async () => {
    const { report } = await createEncryptedReport(ds, deps, { v: 1, description: 'XQZ' });
    const res = await request(t.app.getHttpServer())
      .get(`/api/admin/v1/fixtures/crypto/reports/${report.id}/ok`)
      .set(STAFF);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('XQZ');
  });

  describe.each(RELATOS)('relato %s', (_caso, relato) => {
    it.each(MODOS)('modo %s: status %i, sem relato, DEK ou cifrado na resposta e no log', async (mode, status) => {
      const content =
        mode === 'bad-schema'
          ? ({ v: 1, description: relato, extra: relato } as never)
          : { v: 1 as const, description: relato };
      const { report } = await createEncryptedReport(ds, deps, content);
      const [row] = (await ds.query(`SELECT content_enc, wrapped_dek FROM reports WHERE id = $1`, [
        report.id,
      ])) as Array<{
        content_enc: Buffer;
        wrapped_dek: Buffer;
      }>;
      const wrapped = row.wrapped_dek.toString('utf8');
      const dekCopy = await t.app.get(DataKeyService).withReportKey(wrapped, (dek) => Buffer.from(dek));

      t.logs.clear();
      const res = await request(t.app.getHttpServer())
        .get(`/api/admin/v1/fixtures/crypto/reports/${report.id}/${mode}`)
        .set(STAFF);
      expect(res.status).toBe(status);

      const secrets = [...forms(relato), ...forms(dekCopy), ...forms(row.content_enc), wrapped];
      const haystacks = { resposta: res.text, log: t.logs.text() };
      for (const [onde, texto] of Object.entries(haystacks)) {
        for (const s of secrets) expect(texto.includes(s), `${onde} contém um segredo`).toBe(false);
      }
      dekCopy.fill(0);
    });
  });

  it('as factories usam a camada oficial (sem createCipheriv próprio)', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../support/factories.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('createCipheriv');
    expect(t.app.get(RecordCipher)).toBe(deps.records);
  });
});
