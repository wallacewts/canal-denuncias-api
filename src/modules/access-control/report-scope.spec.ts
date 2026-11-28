import { Role } from '../../common/enums/role.enum.js';
import { allowsReport, reportScope, type ReportAccessFacts } from './report-scope.js';

const { ADMIN, COMPLIANCE_MANAGER: MANAGER, ANALYST, DPO, AUDITOR } = Role;
const ME = '01900000-0000-7000-8000-00000000000a';
const OTHER = '01900000-0000-7000-8000-00000000000b';
const staff = (...roles: Role[]) => ({ id: ME, roles });
const facts = (overrides: Partial<ReportAccessFacts> = {}): ReportAccessFacts => ({
  reportId: '01900000-0000-7000-8000-0000000000f1',
  exists: true,
  assignedToId: null,
  blockedForUser: false,
  shreddedAt: null,
  ...overrides,
});

describe('reportScope (D60)', () => {
  it.each([
    [[MANAGER], 'reports.read', 'all'],
    [[DPO], 'reports.read', 'all'],
    [[ANALYST], 'reports.read', 'assigned'],
    [[ADMIN], 'reports.read', 'none'],
    [[AUDITOR], 'reports.read', 'none'],
    [[], 'reports.list', 'none'],
    [[ADMIN, ANALYST], 'reports.read', 'assigned'],
    [[DPO, ANALYST], 'reports.read', 'all'],
    [[DPO, ANALYST], 'reports.treat', 'assigned'],
    [[DPO], 'reports.treat', 'none'],
    [[MANAGER, DPO], 'reports.triage', 'all'],
    [[DPO], 'identity.approve', 'all'],
    [[MANAGER], 'identity.approve', 'none'],
    [[DPO], 'retention.manage', 'all'],
    [[ADMIN, AUDITOR], 'reports.list', 'none'],
  ] as const)('%j em %s → %s', (roles, ability, kind) => {
    expect(reportScope(staff(...roles), ability)).toEqual({ kind, userId: ME });
  });

  it('sem pessoa, nenhum alcance', () => {
    expect(reportScope(null, 'reports.read').kind).toBe('none');
  });

  it('listar e ler têm o mesmo alcance (a listagem usa list, o registro usa read: precisam concordar)', () => {
    for (const roles of [[MANAGER], [ANALYST], [DPO], [ADMIN], [AUDITOR], [DPO, ANALYST], [ADMIN, ANALYST]]) {
      expect(reportScope(staff(...roles), 'reports.list'), roles.join()).toEqual(
        reportScope(staff(...roles), 'reports.read'),
      );
    }
  });
});

describe('allowsReport', () => {
  it('all: qualquer denúncia existente e não bloqueada', () => {
    const scope = reportScope(staff(MANAGER), 'reports.read');
    expect(allowsReport(scope, facts())).toBe(true);
    expect(allowsReport(scope, facts({ assignedToId: OTHER }))).toBe(true);
  });

  it('assigned: só a atribuída à própria pessoa', () => {
    const scope = reportScope(staff(ANALYST), 'reports.read');
    expect(allowsReport(scope, facts({ assignedToId: ME }))).toBe(true);
    expect(allowsReport(scope, facts({ assignedToId: OTHER }))).toBe(false);
    expect(allowsReport(scope, facts({ assignedToId: null }))).toBe(false);
  });

  it('bloqueio por conflito nega sempre, inclusive para o atribuído, a Gestora e o DPO', () => {
    for (const roles of [[ANALYST], [MANAGER], [DPO], [MANAGER, DPO]]) {
      const scope = reportScope(staff(...roles), 'reports.read');
      expect(allowsReport(scope, facts({ assignedToId: ME, blockedForUser: true })), roles.join()).toBe(false);
    }
  });

  it('denúncia inexistente nunca é permitida', () => {
    expect(allowsReport(reportScope(staff(MANAGER), 'reports.read'), facts({ exists: false }))).toBe(false);
  });

  it('none nunca vira "todas"', () => {
    const scope = reportScope(staff(ADMIN), 'reports.read');
    expect(allowsReport(scope, facts())).toBe(false);
    expect(allowsReport(scope, facts({ assignedToId: ME }))).toBe(false);
  });

  it('expurgo não muda o escopo (o 410 é decidido depois, D59)', () => {
    const scope = reportScope(staff(ANALYST), 'reports.read');
    expect(allowsReport(scope, facts({ assignedToId: ME, shreddedAt: new Date() }))).toBe(true);
    expect(allowsReport(scope, facts({ assignedToId: OTHER, shreddedAt: new Date() }))).toBe(false);
  });
});
