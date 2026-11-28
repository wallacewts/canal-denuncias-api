import { DataSource } from 'typeorm';
import { CliCommandsModule } from '../../src/cli/cli-commands.module.js';
import { CliOutput } from '../../src/cli/cli-output.js';
import { RewrapKeysCommand } from '../../src/cli/rewrap-keys.command.js';
import { VaultAuth } from '../../src/infra/vault/vault-auth.js';
import { VaultClient } from '../../src/infra/vault/vault.client.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { DataKeyService } from '../../src/modules/crypto/data-key.service.js';
import { RewrapService } from '../../src/modules/crypto/rewrap.service.js';
import { createEncryptedReport, cryptoDeps } from '../support/factories.js';
import { createTestApp, type TestApp } from '../support/test-app.js';
import { rotateKek } from '../support/vault-admin.js';

class CapturedOutput {
  lines: string[] = [];
  info(message: string) {
    this.lines.push(message);
  }
  error(message: string) {
    this.lines.push(message);
  }
}

function approleClient(roleId: string, secretId: string): VaultClient {
  const addr = process.env.VAULT_ADDR!;
  return new VaultClient({ addr, timeoutMs: 2000, auth: new VaultAuth({ addr, roleId, secretId, timeoutMs: 2000 }) });
}

/** contracts/cli-rewrap-keys.md: saídas, códigos e nada de valores na saída. */
describe('rewrap-keys (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;
  const output = new CapturedOutput();
  let command: RewrapKeysCommand;

  beforeAll(async () => {
    t = await createTestApp({
      vault: 'maintenance',
      imports: [CliCommandsModule],
      overrides: [{ provide: CliOutput, useValue: output }],
    });
    ds = t.app.get(DataSource);
    command = t.app.get(RewrapKeysCommand);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(() => {
    output.lines = [];
  });

  async function seed(): Promise<{ id: string; wrapped: string }> {
    const deps = {
      ...cryptoDeps(t.app),
      dataKeys: new DataKeyService(approleClient('dev-api-role-id', 'dev-api-secret-id')),
    };
    const { report } = await createEncryptedReport(ds, deps, { v: 1, description: 'XQZ' });
    const [{ wrapped }] = (await ds.query(
      `SELECT convert_from(wrapped_dek, 'UTF8') AS wrapped FROM reports WHERE id = $1`,
      [report.id],
    )) as Array<{ wrapped: string }>;
    return { id: report.id, wrapped };
  }

  it('recifra e informa só números e a versão atual (código 0)', async () => {
    const { id, wrapped } = await seed();
    const latest = await rotateKek('report-kek');
    expect(await command.execute({ kek: 'report-kek', batchSize: '50' })).toBe(0);
    expect(output.lines).toEqual([
      expect.stringMatching(
        new RegExp(`^Recifradas: \\d+\\. Ignoradas: 0\\. Falhas: 0\\. Versão atual: v${latest}\\.$`),
      ),
    ]);
    const text = output.lines.join('\n');
    expect(text).not.toContain(id);
    expect(text).not.toContain(wrapped);
    expect(text).not.toContain('vault:v');
  });

  it('nada a fazer (código 0)', async () => {
    await command.execute({ kek: 'report-kek' });
    output.lines = [];
    expect(await command.execute({ kek: 'report-kek' })).toBe(0);
    expect(output.lines[0]).toMatch(/^Nada a recifrar\. Versão atual: v\d+\.$/);
  });

  it.each([
    ['identity-kek', { kek: 'identity-kek' }],
    ['app-kek', { kek: 'app-kek' }],
    ['sem --kek', {}],
    ['lote zero', { kek: 'report-kek', batchSize: '0' }],
    ['lote acima de 1000', { kek: 'report-kek', batchSize: '1001' }],
    ['lote não numérico', { kek: 'report-kek', batchSize: 'XQZ' }],
  ])('recusa opções inválidas (%s) com código 1, sem repetir o valor', async (_caso, options) => {
    expect(await command.execute(options as never)).toBe(1);
    expect(output.lines.join('\n')).not.toContain('XQZ');
  });

  it('com a credencial da API: falta de permissão, código 1', async () => {
    await seed();
    await rotateKek('report-kek');
    const withApi = new RewrapKeysCommand(
      new RewrapService(approleClient('dev-api-role-id', 'dev-api-secret-id'), ds, t.app.get(AuditService)),
      output as unknown as CliOutput,
    );
    expect(await withApi.execute({ kek: 'report-kek' })).toBe(1);
    expect(output.lines).toEqual(['Serviço de chaves indisponível ou sem permissão.']);
    await command.execute({ kek: 'report-kek' });
  });
});
