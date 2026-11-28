import { ActorType } from '../../common/enums/actor-type.enum.js';
import { AuditContext, runAsSystem } from './audit-context.js';

describe('AuditContext (D46)', () => {
  it('fora de qualquer contexto, não há ator', () => {
    expect(AuditContext.current()).toBeNull();
  });

  it('runAsSystem define ator sistema, sem usuário, IP nem user-agent, e sobrevive a await', async () => {
    const seen = await runAsSystem(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return AuditContext.current();
    });
    expect(seen).toEqual({ actorType: ActorType.SYSTEM, actorUserId: null, ip: null, userAgent: null });
    expect(AuditContext.current()).toBeNull();
  });

  it('contextos de execuções paralelas não se misturam', async () => {
    const staff = { actorType: ActorType.STAFF, actorUserId: 'u-1', ip: '10.0.0.1', userAgent: 'ua' } as const;
    const [a, b] = await Promise.all([
      AuditContext.run(staff, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return AuditContext.current();
      }),
      runAsSystem(async () => {
        await new Promise((r) => setTimeout(r, 1));
        return AuditContext.current();
      }),
    ]);
    expect(a?.actorType).toBe(ActorType.STAFF);
    expect(b?.actorType).toBe(ActorType.SYSTEM);
  });

  it('o contexto é imutável para quem o lê', () => {
    return runAsSystem(async () => {
      const ctx = AuditContext.current()!;
      expect(Object.isFrozen(ctx)).toBe(true);
    });
  });
});
