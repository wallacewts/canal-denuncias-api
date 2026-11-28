import { AuditMaintenanceCommand } from '../../src/cli/audit-maintenance.command.js';
import { CliCommandsModule } from '../../src/cli/cli-commands.module.js';
import { CliOutput } from '../../src/cli/cli-output.js';
import { createOldPartition, insertChainedRows } from '../support/audit-chain.js';
import { withRole } from '../support/db-roles.js';
import { requireEnv, withDatabase } from '../support/db-urls.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

class CapturedOutput {
  lines: string[] = [];
  info(message: string) {
    this.lines.push(message);
  }
  error(message: string) {
    this.lines.push(message);
  }
}

/** contracts/cli-audit.md: audit-maintenance (US7, FR-029). */
describe('audit-maintenance (e2e)', () => {
  let t: TestApp;
  const output = new CapturedOutput();
  let command: AuditMaintenanceCommand;
  let original: string;
  let maintenanceUrl: string;

  beforeAll(async () => {
    t = await createTestApp({ imports: [CliCommandsModule], overrides: [{ provide: CliOutput, useValue: output }] });
    original = requireEnv('DATABASE_AUDIT_MAINTENANCE_URL');
    maintenanceUrl = withDatabase(original, t.database.name);
    command = t.app.get(AuditMaintenanceCommand);
    await withRole(t.database, 'superuser', (c) => createOldPartition(c, 2019, 6));
    await withRole(t.database, 'app_runtime', (c) =>
      insertChainedRows(c, [
        { occurredAt: new Date('2019-06-10T00:00:00.000Z'), resourceId: 'antigo' },
        { occurredAt: new Date(), resourceId: 'recente' },
      ]),
    );
  });

  afterAll(async () => {
    process.env.DATABASE_AUDIT_MAINTENANCE_URL = original;
    await t.close();
  });

  const useUrl = (url: string | undefined) => {
    if (url === undefined) delete process.env.DATABASE_AUDIT_MAINTENANCE_URL;
    else process.env.DATABASE_AUDIT_MAINTENANCE_URL = url;
  };

  it('sem DATABASE_AUDIT_MAINTENANCE_URL, recusa com código 1', async () => {
    useUrl(undefined);
    output.lines = [];
    expect(await command.execute({})).toBe(1);
  });

  it('com a URL do perfil da API, falha por permissão (código 1), sem detalhes do banco na saída', async () => {
    useUrl(t.database.runtimeUrl);
    output.lines = [];
    expect(await command.execute({})).toBe(1);
    expect(output.lines.join('\n')).not.toMatch(/app_runtime|permission/);
  });

  it('--dry-run lista o que faria sem alterar nada', async () => {
    useUrl(maintenanceUrl);
    output.lines = [];
    expect(await command.execute({ dryRun: true })).toBe(0);
    expect(JSON.parse(output.lines.at(-1)!)).toEqual({ partitionsCreated: 0, partitionsPurged: 1, rowsRemoved: 1 });
    const still = await withRole(t.database, 'superuser', async (c) =>
      Number((await c.query(`SELECT count(*)::int AS n FROM pg_class WHERE relname = 'audit_logs_2019_06'`)).rows[0].n),
    );
    expect(still).toBe(1);
  });

  it('com o perfil de manutenção, expurga e imprime os totais', async () => {
    output.lines = [];
    expect(await command.execute({})).toBe(0);
    expect(JSON.parse(output.lines.at(-1)!)).toEqual({ partitionsCreated: 0, partitionsPurged: 1, rowsRemoved: 1 });
  });
});
