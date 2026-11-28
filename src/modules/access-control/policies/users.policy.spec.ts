import { Role } from '../../../common/enums/role.enum.js';
import { UserStatus } from '../../../common/enums/user-status.enum.js';
import { UsersPolicy } from './users.policy.js';

const ME = '01900000-0000-7000-8000-000000000001';
const OTHER = '01900000-0000-7000-8000-000000000002';
const user = (...roles: Role[]) => ({ id: ME, roles, status: UserStatus.ACTIVE });

describe('UsersPolicy (feature 005, R10)', () => {
  const policy = new UsersPolicy();

  it('manage: só quem tem users.manage (ADMIN)', () => {
    expect(policy.manage(user(Role.ADMIN))).toBe(true);
    expect(policy.manage(user(Role.ADMIN, Role.ANALYST))).toBe(true);
    for (const role of [Role.COMPLIANCE_MANAGER, Role.ANALYST, Role.DPO, Role.AUDITOR]) {
      expect(policy.manage(user(role))).toBe(false);
    }
    expect(policy.manage(user())).toBe(false);
    expect(policy.manage(null)).toBe(false);
  });

  it('actOnOther: ADMIN sobre outra pessoa', () => {
    expect(policy.actOnOther(user(Role.ADMIN), OTHER)).toBe(true);
  });

  it('actOnOther: nunca sobre si mesmo, mesmo sendo ADMIN (D21)', () => {
    expect(policy.actOnOther(user(Role.ADMIN), ME)).toBe(false);
    expect(policy.actOnOther(user(Role.ADMIN), ME.toUpperCase())).toBe(false);
  });

  it('actOnOther: sem users.manage, nega', () => {
    expect(policy.actOnOther(user(Role.COMPLIANCE_MANAGER), OTHER)).toBe(false);
    expect(policy.actOnOther(null, OTHER)).toBe(false);
  });

  it('actOnOther: id ausente nega; id malformado fica para a validação do parâmetro (400)', () => {
    expect(policy.actOnOther(user(Role.ADMIN), undefined)).toBe(false);
    expect(policy.actOnOther(user(Role.ADMIN), '')).toBe(false);
    expect(policy.actOnOther(user(Role.ADMIN), 'nao-e-uuid')).toBe(true);
  });
});
