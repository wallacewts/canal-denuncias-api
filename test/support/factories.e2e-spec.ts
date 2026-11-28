import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { DecryptionFailedError } from '../../src/modules/crypto/crypto.errors.js';
import { encryptionContext } from '../../src/modules/crypto/encryption-context.js';
import { newRecordId } from '../../src/modules/crypto/record-id.js';
import { ReportContentV1Schema } from '../../src/modules/reports/report-content.js';
import { createCategory, createEncryptedReport, createUser, cryptoDeps, type CryptoDeps } from './factories.js';
import { PublicFixtureModule } from './fixtures/public-fixture.module.js';
import { createTestApp, type TestApp } from './test-app.js';

describe('Factories da base de testes (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;
  let deps: CryptoDeps;

  beforeAll(async () => {
    t = await createTestApp({ imports: [PublicFixtureModule] });
    ds = t.app.get(DataSource);
    deps = cryptoDeps(t.app);
  });

  afterAll(async () => {
    await t.close();
  });

  it('cria usuário com perfis, sem carregar o hash', async () => {
    const user = await createUser(ds, { roles: [Role.ANALYST, Role.DPO] });
    expect(user.roles.map((r) => r.role).sort()).toEqual([Role.ANALYST, Role.DPO]);
    // select: false: o hash não é carregado. Com target ES2023 a propriedade existe na instância, mas vazia.
    expect(user.passwordHash).toBeUndefined();
    expect(JSON.stringify(user)).not.toContain('$test$');
    const [{ count }] = await ds.query(`SELECT count(*)::int AS count FROM user_roles WHERE user_id = $1`, [user.id]);
    expect(count).toBe(2);
  });

  it('cria categoria com código único', async () => {
    const [a, b] = [await createCategory(ds), await createCategory(ds)];
    expect(a.code).not.toBe(b.code);
  });

  it.each([
    ['longo', 'Planilha com CPFs de clientes enviada para e-mail pessoal do gerente de vendas'],
    ['curto', 'XQZ'],
  ])('cria denúncia cifrada (relato %s) que só abre com a DEK e o contexto certos', async (_caso, description) => {
    const { report } = await createEncryptedReport(ds, deps, { v: 1, description });
    const [row] = await ds.query(`SELECT content_enc, wrapped_dek FROM reports WHERE id = $1`, [report.id]);

    expect((row.content_enc as Buffer).includes(Buffer.from(description))).toBe(false);
    expect((row.content_enc as Buffer)[0]).toBe(1); // versão do formato

    // Abre pela mesma interface que os módulos vão usar (CryptoModule).
    const wrapped = (row.wrapped_dek as Buffer).toString('utf8');
    const content = await deps.dataKeys.withReportKey(wrapped, (dek) =>
      deps.records.openJson(dek, encryptionContext('reports.content_enc', report.id), row.content_enc, {
        1: ReportContentV1Schema,
      }),
    );
    expect(content).toEqual({ v: 1, description });

    // Contexto de outra denúncia: a troca de ciphertext entre linhas é recusada.
    await expect(
      deps.dataKeys.withReportKey(wrapped, (dek) =>
        deps.records.openJson(dek, encryptionContext('reports.content_enc', newRecordId()), row.content_enc, {
          1: ReportContentV1Schema,
        }),
      ),
    ).rejects.toBeInstanceOf(DecryptionFailedError);
  });

  it('o relato de uma denúncia criada não aparece no log de uma requisição pública', async () => {
    t.logs.clear();
    await createEncryptedReport(ds, deps, { v: 1, description: 'RELATO-QUE-NAO-VAI-PARA-O-LOG XQZ' });
    await request(t.app.getHttpServer()).get('/api/public/v1/fixtures/cookie').expect(200);
    expect(t.logs.text()).not.toContain('RELATO-QUE-NAO-VAI-PARA-O-LOG');
  });
});
