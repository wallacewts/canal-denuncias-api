import { Role } from '../../common/enums/role.enum.js';

/**
 * Catálogo único de habilidades (D55, research R1 da feature 005): fonte do `GET /me` e das políticas. Uma linha da
 * matriz do ACL-01 pode virar mais de um código. Código novo é aditivo; renomear ou remover é mudança incompatível
 * (o front valida o formato e decide menu e rotas por estes códigos).
 */
export const ABILITY_CODE_PATTERN = /^[a-z][a-z-]*\.[a-z][a-z-]*$/;

export type AbilityScope = 'global' | 'record';

interface AbilityEntry {
  readonly roles: readonly Role[];
  /** `record`: a pessoa pode exercer a habilidade em algum registro; a decisão final continua no servidor. */
  readonly scope: AbilityScope;
}

const { ADMIN, COMPLIANCE_MANAGER, ANALYST, DPO, AUDITOR } = Role;

export const ABILITY_CATALOG = {
  'users.manage': { roles: [ADMIN], scope: 'global' },
  'categories.manage': { roles: [ADMIN], scope: 'global' },
  'settings.sla': { roles: [ADMIN], scope: 'global' },
  'retention.manage': { roles: [DPO], scope: 'record' },
  'reports.list': { roles: [COMPLIANCE_MANAGER, ANALYST, DPO], scope: 'record' },
  'reports.read': { roles: [COMPLIANCE_MANAGER, ANALYST, DPO], scope: 'record' },
  'reports.triage': { roles: [COMPLIANCE_MANAGER], scope: 'record' },
  'reports.treat': { roles: [COMPLIANCE_MANAGER, ANALYST], scope: 'record' },
  'identity.request': { roles: [COMPLIANCE_MANAGER, ANALYST], scope: 'record' },
  'identity.approve': { roles: [DPO], scope: 'record' },
  'audit.read': { roles: [AUDITOR], scope: 'global' },
  'dashboard.read': { roles: [COMPLIANCE_MANAGER, DPO, AUDITOR], scope: 'global' },
} as const satisfies Record<string, AbilityEntry>;

export type Ability = keyof typeof ABILITY_CATALOG;

const CODES = Object.keys(ABILITY_CATALOG).sort() as Ability[];

/** Códigos concedidos por um conjunto de perfis: união, ordenada, sem repetição. */
export function abilitiesFor(roles: readonly Role[]): Ability[] {
  return CODES.filter((code) => (ABILITY_CATALOG[code].roles as readonly Role[]).some((r) => roles.includes(r)));
}

export function hasAbility(user: { roles: readonly Role[] } | null | undefined, code: Ability): boolean {
  return Boolean(user && (ABILITY_CATALOG[code].roles as readonly Role[]).some((r) => user.roles.includes(r)));
}
