import { ActorType } from '../../common/enums/actor-type.enum.js';
import { AuditContext } from '../../modules/audit/audit-context.js';
import { systemJob } from './system-job.js';

describe('systemJob', () => {
  it('roda o handler do job com ator sistema', async () => {
    const handler = systemJob(async (payload: { id: string }) => ({
      id: payload.id,
      actor: AuditContext.current()?.actorType,
    }));
    expect(await handler({ id: 'x' })).toEqual({ id: 'x', actor: ActorType.SYSTEM });
    expect(AuditContext.current()).toBeNull();
  });
});
