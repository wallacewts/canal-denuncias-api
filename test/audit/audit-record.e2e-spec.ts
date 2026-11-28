import { DataSource } from 'typeorm';
import { AuditResult } from '../../src/common/enums/audit-result.enum.js';
import { Role } from '../../src/common/enums/role.enum.js';
import { AuditAction, AuditResourceType } from '../../src/modules/audit/audit-action.enum.js';
import { runAsSystem } from '../../src/modules/audit/audit-context.js';
import { AuditEntryRejected } from '../../src/modules/audit/audit.errors.js';
import { AuditService, type AuditEntry } from '../../src/modules/audit/audit.service.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Catálogo e metadata validados antes de qualquer gravação (US1, FR-001 a FR-006). */
describe('AuditService.record: catálogo e metadata (e2e)', () => {
  let t: TestApp;
  let audit: AuditService;
  let ds: DataSource;

  beforeAll(async () => {
    t = await createTestApp();
    audit = t.app.get(AuditService);
    ds = t.app.get(DataSource);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(() => t.logs.clear());

  const count = async (): Promise<number> =>
    Number(((await ds.query(`SELECT count(*)::int AS n FROM audit_logs`)) as Array<{ n: number }>)[0]!.n);

  const base = {
    action: AuditAction.USER_CREATED,
    resourceType: AuditResourceType.USER,
    resourceId: '0190a6e2-7c1b-7d3e-9f00-1a2b3c4d5e6f',
    result: AuditResult.SUCCESS,
    metadata: { roles: [Role.ADMIN], forced: false },
  } as AuditEntry;

  it.each([
    ['ação fora do catálogo', { ...base, action: 'XQZ' }],
    ['tipo de recurso fora do catálogo', { ...base, resourceType: 'XQZ' }],
    ['identificador de recurso com espaço', { ...base, resourceId: 'XQZ relato' }],
    ['metadata com campo não previsto', { ...base, metadata: { roles: [Role.ADMIN], forced: false, texto: 'XQZ' } }],
    [
      'metadata com texto longo',
      { ...base, metadata: { roles: [Role.ADMIN], forced: false, texto: 'XQZ'.repeat(200) } },
    ],
  ])('recusa %s antes de abrir a transação, sem eco no erro nem no log', async (_caso, entry) => {
    const before = await count();
    const error = await runAsSystem(() => audit.record(entry as AuditEntry)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuditEntryRejected);
    expect(JSON.stringify({ m: (error as Error).message, r: (error as AuditEntryRejected).reasons })).not.toContain(
      'XQZ',
    );
    expect(t.logs.text()).not.toContain('XQZ');
    expect(await count()).toBe(before);
  });

  it('as ações já gravadas hoje continuam gravando (FR-006)', async () => {
    await runAsSystem(() => audit.record(base));
    await runAsSystem(() =>
      audit.record({
        ...base,
        action: AuditAction.KEYS_REWRAPPED,
        resourceType: AuditResourceType.KEK,
        resourceId: 'report-kek',
        metadata: { latestVersion: 2, batch: 1, rewrapped: 3, skipped: 0 },
      } as AuditEntry),
    );
    await runAsSystem(() =>
      audit.record({
        ...base,
        action: AuditAction.KEYS_REWRAP_RUN,
        resourceType: AuditResourceType.KEK,
        resourceId: 'report-kek',
        metadata: { latestVersion: 2, batches: 1, rewrapped: 3, skipped: 0, failed: 0 },
      } as AuditEntry),
    );
    const rows = (await ds.query(`SELECT action FROM audit_logs ORDER BY id DESC LIMIT 3`)) as Array<{
      action: string;
    }>;
    expect(rows.map((r) => r.action)).toEqual(['KEYS_REWRAP_RUN', 'KEYS_REWRAPPED', 'USER_CREATED']);
  });
});
