import { NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Role } from '../../common/enums/role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import { DomainError } from '../../common/http/domain-error.js';
import type { StaffUser } from '../../infra/auth/staff-user.js';
import { AuditAction, AuditResourceType } from '../audit/audit-action.enum.js';
import type { AuditService } from '../audit/audit.service.js';
import { ReportAccessService } from './report-access.service.js';

const ME = '01900000-0000-7000-8000-00000000000a';
const OTHER = '01900000-0000-7000-8000-00000000000b';
const REPORT = '01900000-0000-7000-8000-0000000000f1';
const analyst: StaffUser = { id: ME, roles: [Role.ANALYST], status: UserStatus.ACTIVE };

interface Row {
  exists: boolean;
  assigned_to_id: string | null;
  shredded_at: Date | null;
  blocked: boolean;
}

function setup(row: Row) {
  const query = vi.fn().mockResolvedValue([row]);
  const record = vi.fn().mockResolvedValue({});
  const service = new ReportAccessService({ query } as unknown as DataSource, { record } as unknown as AuditService);
  return { service, query, record };
}

const missing: Row = { exists: false, assigned_to_id: null, shredded_at: null, blocked: false };
const others: Row = { exists: true, assigned_to_id: OTHER, shredded_at: null, blocked: false };
const mine: Row = { exists: true, assigned_to_id: ME, shredded_at: null, blocked: false };

describe('ReportAccessService.resolve (D59, research R2)', () => {
  it('os dois 404 fazem a mesma consulta e a mesma escrita; só o motivo muda', async () => {
    const a = setup(others);
    const b = setup(missing);
    await expect(a.service.resolve(analyst, REPORT, 'reports.read')).rejects.toBeInstanceOf(NotFoundException);
    await expect(b.service.resolve(analyst, REPORT, 'reports.read')).rejects.toBeInstanceOf(NotFoundException);
    expect(a.query.mock.calls).toEqual(b.query.mock.calls);
    expect(a.query).toHaveBeenCalledTimes(1);
    const entry = (reason: string) => ({
      action: AuditAction.ACCESS_DENIED,
      resourceType: AuditResourceType.REPORT,
      resourceId: REPORT,
      result: 'DENIED',
      metadata: { code: 'reports.read', reason },
    });
    expect(a.record.mock.calls).toEqual([[entry('OUT_OF_SCOPE')]]);
    expect(b.record.mock.calls).toEqual([[entry('NOT_FOUND')]]);
  });

  it('os dois 404 têm a mesma mensagem', async () => {
    const messages = await Promise.all(
      [others, missing].map((row) =>
        setup(row)
          .service.resolve(analyst, REPORT, 'reports.read')
          .catch((e: Error) => JSON.stringify((e as NotFoundException).getResponse())),
      ),
    );
    expect(messages[0]).toEqual(messages[1]);
  });

  it('bloqueado: 404 com OUT_OF_SCOPE mesmo atribuído', async () => {
    const { service, record } = setup({ ...mine, blocked: true });
    await expect(service.resolve(analyst, REPORT, 'reports.read')).rejects.toBeInstanceOf(NotFoundException);
    expect(record.mock.calls[0][0].metadata).toEqual({ code: 'reports.read', reason: 'OUT_OF_SCOPE' });
  });

  it('no escopo: devolve os fatos sem gravar nada', async () => {
    const { service, record } = setup(mine);
    await expect(service.resolve(analyst, REPORT, 'reports.read')).resolves.toEqual({
      reportId: REPORT,
      exists: true,
      assignedToId: ME,
      blockedForUser: false,
      shreddedAt: null,
    });
    expect(record).not.toHaveBeenCalled();
  });

  it('expurgada: 410 só com content e dentro do escopo; fora do escopo, 404 (o escopo vem antes)', async () => {
    const shreddedAt = new Date('2026-01-01T00:00:00Z');
    const inScope = setup({ ...mine, shredded_at: shreddedAt });
    const error = await inScope.service
      .resolve(analyst, REPORT, 'reports.read', { content: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).getStatus()).toBe(410);
    expect((error as DomainError).code).toBe('REPORT_SHREDDED');
    expect(inScope.record).not.toHaveBeenCalled();

    await expect(
      setup({ ...mine, shredded_at: shreddedAt }).service.resolve(analyst, REPORT, 'reports.read'),
    ).resolves.toMatchObject({ shreddedAt });

    const outside = setup({ ...others, shredded_at: shreddedAt });
    await expect(outside.service.resolve(analyst, REPORT, 'reports.read', { content: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(outside.record.mock.calls[0][0].metadata.reason).toBe('OUT_OF_SCOPE');
  });

  it('a habilidade decide o alcance: o analista não alcança nada em triagem', async () => {
    const { service, record } = setup(mine);
    await expect(service.resolve(analyst, REPORT, 'reports.triage')).rejects.toBeInstanceOf(NotFoundException);
    expect(record.mock.calls[0][0].metadata).toEqual({ code: 'reports.triage', reason: 'OUT_OF_SCOPE' });
  });
});
