import { AuditResourceType } from '../audit/audit-action.enum.js';
import type { Ability } from './abilities.js';
import type { UsersPolicy } from './policies/users.policy.js';

/**
 * Política → tipo de recurso, e método → código do catálogo (D61, research R3 da feature 007). O evento de negação do
 * `@nestjs/authorization` traz o nome da classe e do método; a trilha grava também o código que o Auditor reconhece
 * no catálogo e o tipo de recurso da política. Método novo de política = entrada aqui (o teste falha sem ela).
 */
type Methods<P> = { [K in keyof P]: P[K] extends (...args: never[]) => unknown ? K : never }[keyof P] & string;

interface PolicyAbilities<P> {
  readonly resourceType: AuditResourceType;
  readonly abilities: Readonly<Record<Methods<P>, Ability>>;
}

const entry = <P>(value: PolicyAbilities<P>) => value;

export const POLICY_ABILITIES = {
  UsersPolicy: entry<UsersPolicy>({
    resourceType: AuditResourceType.USER,
    abilities: { manage: 'users.manage', actOnOther: 'users.manage' },
  }),
} as const;

export interface PolicyAbilityInfo {
  code?: Ability;
  resourceType: AuditResourceType;
}

/** Código e tipo de recurso de uma negação. Sem política (rota sem declaração) ou nome desconhecido: `SYSTEM`. */
export function policyAbility(policy: string | null, method: string | null): PolicyAbilityInfo {
  const found =
    policy && Object.hasOwn(POLICY_ABILITIES, policy)
      ? (POLICY_ABILITIES[policy as keyof typeof POLICY_ABILITIES] as PolicyAbilities<Record<string, never>>)
      : undefined;
  if (!found) return { resourceType: AuditResourceType.SYSTEM };
  const abilities = found.abilities as Readonly<Record<string, Ability>>;
  const code = method && Object.hasOwn(abilities, method) ? abilities[method] : undefined;
  return code ? { code, resourceType: found.resourceType } : { resourceType: found.resourceType };
}
