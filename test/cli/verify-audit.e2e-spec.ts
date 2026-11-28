import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CliOutput } from '../../src/cli/cli-output.js';
import { CliCommandsModule } from '../../src/cli/cli-commands.module.js';
import { VerifyAuditCommand } from '../../src/cli/verify-audit.command.js';
import { AuditResult } from '../../src/common/enums/audit-result.enum.js';
import { AuditAction, AuditResourceType } from '../../src/modules/audit/audit-action.enum.js';
import { runAsSystem } from '../../src/modules/audit/audit-context.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { withRole } from '../support/db-roles.js';
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

/** contracts/cli-audit.md: verify-audit sai com 0 íntegra e 1 quebrada (US6, FR-026). */
describe('verify-audit (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;
  const output = new CapturedOutput();

  beforeAll(async () => {
    t = await createTestApp({ imports: [CliCommandsModule], overrides: [{ provide: CliOutput, useValue: output }] });
    ds = t.app.get(DataSource);
    const audit = t.app.get(AuditService);
    await runAsSystem(async () => {
      for (let i = 0; i < 5; i++) {
        await audit.record({
          action: AuditAction.REPORT_VIEWED,
          resourceType: AuditResourceType.REPORT,
          resourceId: randomUUID(),
          result: AuditResult.SUCCESS,
        });
      }
    });
  });

  afterAll(async () => {
    await t.close();
  });

  it('trilha íntegra: código 0, JSON com ok true e registro SYSTEM sem IP', async () => {
    output.lines = [];
    expect(await t.app.get(VerifyAuditCommand).execute()).toBe(0);
    const json = JSON.parse(output.lines.at(-1)!);
    expect(json).toEqual({ ok: true, checked: expect.any(Number), firstBrokenId: null, anchoredAt: null });
    const [row] = (await ds.query(
      `SELECT actor_type, ip FROM audit_logs WHERE action = 'AUDIT_CHAIN_VERIFIED' ORDER BY id DESC LIMIT 1`,
    )) as Array<Record<string, unknown>>;
    expect(row).toEqual({ actor_type: 'SYSTEM', ip: null });
  });

  it('trilha quebrada: código 1', async () => {
    const [{ id }] = (await ds.query(`SELECT id FROM audit_logs ORDER BY id LIMIT 1 OFFSET 2`)) as Array<{
      id: string;
    }>;
    await withRole(t.database, 'superuser', async (c) => {
      await c.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable');
      await c.query(`UPDATE audit_logs SET resource_id = 'XQZ' WHERE id = $1`, [id]);
      await c.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable');
    });
    output.lines = [];
    expect(await t.app.get(VerifyAuditCommand).execute()).toBe(1);
    expect(JSON.parse(output.lines.at(-1)!)).toEqual(expect.objectContaining({ ok: false, firstBrokenId: String(id) }));
    expect(output.lines.join('\n')).not.toContain('XQZ');
  });
});
