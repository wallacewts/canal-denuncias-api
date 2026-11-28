import { Role } from '../../../common/enums/role.enum.js';
import { UserStatus } from '../../../common/enums/user-status.enum.js';
import type { StaffUser } from '../../../infra/auth/staff-user.js';
import type { ReportAccessFacts } from '../report-scope.js';
import { AuditPolicy } from './audit.policy.js';
import { CatalogPolicy } from './catalog.policy.js';
import { DashboardPolicy } from './dashboard.policy.js';
import { IdentityRevealPolicy } from './identity-reveal.policy.js';
import { ReportsPolicy } from './reports.policy.js';
import { RetentionPolicy } from './retention.policy.js';
import { SettingsPolicy } from './settings.policy.js';
import { UsersPolicy } from './users.policy.js';

/**
 * Matriz do ACL-01 em tabela (ACL-05, SC-001, research R8): perfil isolado e combinado × método de cada política ×
 * situação da denúncia. O esperado é escrito à mão a partir de `docs/tarefas/05-access-control.md` (não lê o
 * catálogo): `all` = qualquer denúncia; `assigned` = só a atribuída à pessoa; bloqueio por conflito nega sempre.
 */
const { ADMIN, COMPLIANCE_MANAGER: MANAGER, ANALYST, DPO, AUDITOR } = Role;
const ME = '01900000-0000-7000-8000-00000000000a';
const OTHER = '01900000-0000-7000-8000-00000000000b';

type Reach = 'all' | 'assigned';
type Situation = 'mine' | 'others' | 'unassigned' | 'blocked';
const SITUATIONS: Situation[] = ['mine', 'others', 'unassigned', 'blocked'];

const factsFor = (situation: Situation): ReportAccessFacts => ({
  reportId: '01900000-0000-7000-8000-0000000000f1',
  exists: true,
  assignedToId: situation === 'mine' || situation === 'blocked' ? ME : situation === 'others' ? OTHER : null,
  blockedForUser: situation === 'blocked',
  shreddedAt: null,
});

/** Linhas globais da matriz: quem tem. */
const GLOBAL: Record<string, Role[]> = {
  'UsersPolicy.manage': [ADMIN],
  'CatalogPolicy.manageCategories': [ADMIN],
  'SettingsPolicy.sla': [ADMIN],
  'SettingsPolicy.retention': [DPO],
  'RetentionPolicy.manage': [DPO],
  'ReportsPolicy.list': [MANAGER, ANALYST, DPO],
  'ReportsPolicy.readAny': [MANAGER, ANALYST, DPO],
  'ReportsPolicy.triageAny': [MANAGER],
  'ReportsPolicy.treatAny': [MANAGER, ANALYST],
  'IdentityRevealPolicy.requestAny': [MANAGER, ANALYST],
  'IdentityRevealPolicy.decideAny': [DPO],
  'AuditPolicy.read': [AUDITOR],
  'DashboardPolicy.read': [MANAGER, DPO, AUDITOR],
};

/** Linhas por registro da matriz: alcance de cada perfil ("✅" = todas; "✅ (se atribuída)" = só as suas). */
const RECORD: Record<string, Partial<Record<Role, Reach>>> = {
  'ReportsPolicy.read': { [MANAGER]: 'all', [ANALYST]: 'assigned', [DPO]: 'all' },
  'ReportsPolicy.triage': { [MANAGER]: 'all' },
  'ReportsPolicy.treat': { [MANAGER]: 'all', [ANALYST]: 'assigned' },
  'IdentityRevealPolicy.request': { [MANAGER]: 'all', [ANALYST]: 'assigned' },
  'IdentityRevealPolicy.decide': { [DPO]: 'all' },
  'RetentionPolicy.manageReport': { [DPO]: 'all' },
};

const policies = {
  UsersPolicy: new UsersPolicy(),
  CatalogPolicy: new CatalogPolicy(),
  SettingsPolicy: new SettingsPolicy(),
  RetentionPolicy: new RetentionPolicy(),
  ReportsPolicy: new ReportsPolicy(),
  IdentityRevealPolicy: new IdentityRevealPolicy(),
  AuditPolicy: new AuditPolicy(),
  DashboardPolicy: new DashboardPolicy(),
};

const staff = (roles: Role[], id = ME): StaffUser => ({ id, roles, status: UserStatus.ACTIVE });

/** Chama `Política.método` como o pacote faria (pedido de revelação feito por outra pessoa, salvo indicação). */
function decide(key: string, user: StaffUser | null, situation: Situation, requestedById = OTHER): boolean {
  const [policyName, method] = key.split('.') as [keyof typeof policies, string];
  const policy = policies[policyName] as unknown as Record<string, (...args: unknown[]) => boolean>;
  if (key === 'IdentityRevealPolicy.decide') return policy[method](user, factsFor(situation), { requestedById });
  if (key in RECORD) return policy[method](user, factsFor(situation));
  return policy[method](user);
}

function expected(key: string, roles: Role[], situation: Situation): boolean {
  if (key in GLOBAL) return roles.some((r) => GLOBAL[key].includes(r));
  if (situation === 'blocked') return false;
  const reaches = roles.map((r) => RECORD[key][r]);
  if (reaches.includes('all')) return true;
  return reaches.includes('assigned') && situation === 'mine';
}

const ISOLATED = [[ADMIN], [MANAGER], [ANALYST], [DPO], [AUDITOR]];
const COMBINED = [
  [ADMIN, ANALYST],
  [DPO, ANALYST],
  [MANAGER, DPO],
  [ADMIN, AUDITOR],
];
const KEYS = [...Object.keys(GLOBAL), ...Object.keys(RECORD)];
const cases = [...ISOLATED, ...COMBINED].flatMap((roles) =>
  KEYS.flatMap((key) => SITUATIONS.map((situation) => [roles.join('+'), key, situation, roles] as const)),
);

describe('Matriz de permissões (ACL-01, ACL-05)', () => {
  it('cobre todas as linhas: 5 perfis isolados × métodos × 4 situações (≥ 180 casos)', () => {
    expect(ISOLATED.length * KEYS.length * SITUATIONS.length).toBeGreaterThanOrEqual(180);
  });

  it.each(cases)('%s · %s · %s', (_label, key, situation, roles) => {
    expect(decide(key, staff([...roles]), situation)).toBe(expected(key, [...roles], situation));
  });

  it.each(KEYS)('sem pessoa, %s nega', (key) => {
    for (const situation of SITUATIONS) expect(decide(key, null, situation)).toBe(false);
  });
});

describe('Regras que a matriz não mostra sozinha', () => {
  it('DPO lê todas e nunca trata, tria nem pede revelação (D20)', () => {
    const dpo = staff([DPO]);
    for (const situation of ['mine', 'others', 'unassigned'] as const) {
      expect(decide('ReportsPolicy.read', dpo, situation)).toBe(true);
      expect(decide('ReportsPolicy.treat', dpo, situation)).toBe(false);
      expect(decide('ReportsPolicy.triage', dpo, situation)).toBe(false);
      expect(decide('IdentityRevealPolicy.request', dpo, situation)).toBe(false);
    }
  });

  it('ninguém decide o próprio pedido de revelação (four-eyes), nem com o id em outra caixa', () => {
    const dpo = staff([DPO, ANALYST]);
    expect(decide('IdentityRevealPolicy.decide', dpo, 'mine', OTHER)).toBe(true);
    expect(decide('IdentityRevealPolicy.decide', dpo, 'mine', ME)).toBe(false);
    expect(decide('IdentityRevealPolicy.decide', dpo, 'mine', ME.toUpperCase())).toBe(false);
  });

  it('ninguém age sobre o próprio cadastro (D21); sobre outra pessoa, só o ADMIN', () => {
    const users = policies.UsersPolicy;
    expect(users.actOnOther(staff([ADMIN]), ME)).toBe(false);
    expect(users.actOnOther(staff([ADMIN]), OTHER)).toBe(true);
    expect(users.actOnOther(staff([MANAGER, DPO, ANALYST, AUDITOR]), OTHER)).toBe(false);
  });

  it('denúncia inexistente nunca é alcançada, nem pela Gestora', () => {
    const missing = { ...factsFor('unassigned'), exists: false };
    expect(policies.ReportsPolicy.read(staff([MANAGER]), missing)).toBe(false);
    expect(policies.ReportsPolicy.treat(staff([MANAGER]), missing)).toBe(false);
  });
});
