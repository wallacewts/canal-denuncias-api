import { Role } from '../../common/enums/role.enum.js';

/**
 * Catálogo único de habilidades (D55, research R1 da feature 005): fonte do `GET /me` e das políticas. Uma linha da
 * matriz do ACL-01 pode virar mais de um código. Código novo é aditivo; renomear ou remover é mudança incompatível
 * (o front valida o formato e decide menu e rotas por estes códigos).
 */
export const ABILITY_CODE_PATTERN = /^[a-z][a-z-]*\.[a-z][a-z-]*$/;

export type AbilityScope = 'global' | 'record';

/** Alcance de um perfil numa habilidade por registro (D60): todas as denúncias ou só as atribuídas à pessoa. */
export type RecordReach = 'all' | 'assigned';

export interface CatalogEntry {
  readonly roles: readonly Role[];
  /** `record`: a pessoa pode exercer a habilidade em algum registro; a decisão final continua no servidor. */
  readonly scope: AbilityScope;
  /**
   * Só nas habilidades `record`, com os mesmos perfis de `roles`: até onde cada perfil alcança. É o único lugar que
   * liga perfil a alcance; a função de escopo (`report-scope.ts`) lê daqui. Não sai no `GET /me`.
   */
  readonly recordScope?: Partial<Readonly<Record<Role, RecordReach>>>;
}

const { ADMIN, COMPLIANCE_MANAGER, ANALYST, DPO, AUDITOR } = Role;

export const ABILITY_CATALOG = {
  'users.manage': { roles: [ADMIN], scope: 'global' },
  'categories.manage': { roles: [ADMIN], scope: 'global' },
  'settings.sla': { roles: [ADMIN], scope: 'global' },
  'retention.manage': { roles: [DPO], scope: 'record', recordScope: { DPO: 'all' } },
  'reports.list': {
    roles: [COMPLIANCE_MANAGER, ANALYST, DPO],
    scope: 'record',
    recordScope: { COMPLIANCE_MANAGER: 'all', ANALYST: 'assigned', DPO: 'all' },
  },
  'reports.read': {
    roles: [COMPLIANCE_MANAGER, ANALYST, DPO],
    scope: 'record',
    recordScope: { COMPLIANCE_MANAGER: 'all', ANALYST: 'assigned', DPO: 'all' },
  },
  'reports.triage': { roles: [COMPLIANCE_MANAGER], scope: 'record', recordScope: { COMPLIANCE_MANAGER: 'all' } },
  'reports.treat': {
    roles: [COMPLIANCE_MANAGER, ANALYST],
    scope: 'record',
    recordScope: { COMPLIANCE_MANAGER: 'all', ANALYST: 'assigned' },
  },
  'identity.request': {
    roles: [COMPLIANCE_MANAGER, ANALYST],
    scope: 'record',
    recordScope: { COMPLIANCE_MANAGER: 'all', ANALYST: 'assigned' },
  },
  'identity.approve': { roles: [DPO], scope: 'record', recordScope: { DPO: 'all' } },
  'audit.read': { roles: [AUDITOR], scope: 'global' },
  'dashboard.read': { roles: [COMPLIANCE_MANAGER, DPO, AUDITOR], scope: 'global' },
} as const satisfies Record<string, CatalogEntry>;

export type Ability = keyof typeof ABILITY_CATALOG;

const CODES = Object.keys(ABILITY_CATALOG).sort() as Ability[];

/** Códigos concedidos por um conjunto de perfis: união, ordenada, sem repetição. */
export function abilitiesFor(roles: readonly Role[]): Ability[] {
  return CODES.filter((code) => (ABILITY_CATALOG[code].roles as readonly Role[]).some((r) => roles.includes(r)));
}

export function hasAbility(user: { roles: readonly Role[] } | null | undefined, code: Ability): boolean {
  return Boolean(user && (ABILITY_CATALOG[code].roles as readonly Role[]).some((r) => user.roles.includes(r)));
}
