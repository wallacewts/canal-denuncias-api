import { AuditResourceType } from '../audit/audit-action.enum.js';
import { ABILITY_CATALOG } from './abilities.js';
import { AccessControlModule } from './access-control.module.js';
import { POLICY_ABILITIES, policyAbility } from './policy-abilities.js';

type Ctor = { name: string; prototype: object };

/** Métodos de uma política: tudo no protótipo que é função, menos o construtor. */
function methodsOf(policy: Ctor): string[] {
  return Object.getOwnPropertyNames(policy.prototype).filter(
    (name) => name !== 'constructor' && typeof (policy.prototype as Record<string, unknown>)[name] === 'function',
  );
}

/** Políticas registradas no módulo (providers com `@Policy()`). */
const policies = (Reflect.getMetadata('providers', AccessControlModule) as Ctor[]).filter((p) =>
  p.name.endsWith('Policy'),
);

describe('Mapa política → recurso e método → código do catálogo (D61)', () => {
  it('o módulo registra políticas', () => {
    expect(policies.map((p) => p.name)).toContain('UsersPolicy');
  });

  it.each(policies.map((p) => [p.name, p] as const))('%s: todo método tem código do catálogo', (name, policy) => {
    const entry = POLICY_ABILITIES[name as keyof typeof POLICY_ABILITIES];
    expect(entry, name).toBeDefined();
    expect(Object.values(AuditResourceType)).toContain(entry.resourceType);
    expect(Object.keys(entry.abilities).sort()).toEqual(methodsOf(policy).sort());
    for (const code of Object.values(entry.abilities) as string[]) expect(Object.keys(ABILITY_CATALOG)).toContain(code);
  });

  it('nenhuma entrada sobra sem política registrada', () => {
    expect(Object.keys(POLICY_ABILITIES).sort()).toEqual(policies.map((p) => p.name).sort());
  });

  it('UsersPolicy: manage e actOnOther são users.manage sobre USER', () => {
    expect(policyAbility('UsersPolicy', 'manage')).toEqual({
      code: 'users.manage',
      resourceType: AuditResourceType.USER,
    });
    expect(policyAbility('UsersPolicy', 'actOnOther')).toEqual({
      code: 'users.manage',
      resourceType: AuditResourceType.USER,
    });
  });

  it('rota sem declaração (sem política) ou nome desconhecido: SYSTEM, sem código', () => {
    expect(policyAbility(null, null)).toEqual({ resourceType: AuditResourceType.SYSTEM });
    expect(policyAbility('XQZ', 'read')).toEqual({ resourceType: AuditResourceType.SYSTEM });
    expect(policyAbility('UsersPolicy', 'XQZ')).toEqual({ resourceType: AuditResourceType.USER });
  });
});
