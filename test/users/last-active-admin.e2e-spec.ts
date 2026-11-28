import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum.js';
import { UserStatus } from '../../src/common/enums/user-status.enum.js';
import type { StaffUser } from '../../src/infra/auth/staff-user.js';
import { AuditContext } from '../../src/modules/audit/audit-context.js';
import { ActorType } from '../../src/common/enums/actor-type.enum.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { createUser } from '../support/factories.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import { activeAdmins, createUsersApp, onlyActiveAdmins } from './support.js';

/**
 * FR-011 direto no serviço: pela API, quem age é sempre um Administrador ativo que não age sobre si, então a
 * situação não surge numa operação isolada. A regra é a defesa da própria operação, para qualquer chamador; aqui o
 * único Administrador ativo tenta tirar o próprio acesso (a política da rota impediria antes).
 */
describe('Nunca sem Administrador ativo, no serviço (integração)', () => {
  let t: TestApp & { clock: TestClock };
  let ds: DataSource;
  let service: UsersService;

  beforeAll(async () => {
    t = await createUsersApp();
    ds = t.app.get<DataSource>(getDataSourceToken());
    service = t.app.get(UsersService);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const asStaff = <T>(actor: StaffUser, fn: () => Promise<T>) =>
    AuditContext.run({ actorType: ActorType.STAFF, actorUserId: actor.id, ip: null, userAgent: null }, fn);

  const soleAdmin = async (): Promise<StaffUser> => {
    const user = await createUser(ds, { roles: [Role.ADMIN, Role.DPO] });
    await onlyActiveAdmins(ds, user.id);
    return { id: user.id, roles: [Role.ADMIN, Role.DPO], status: UserStatus.ACTIVE };
  };

  it.each([
    ['bloquear', (s: UsersService, a: StaffUser) => s.changeStatus(a, a.id, UserStatus.BLOCKED)],
    ['desativar', (s: UsersService, a: StaffUser) => s.changeStatus(a, a.id, UserStatus.DISABLED)],
    ['retirar o perfil', (s: UsersService, a: StaffUser) => s.changeRoles(a, a.id, [Role.DPO])],
  ])('%s o último Administrador ativo: 409 LAST_ACTIVE_ADMIN e nada muda', async (_caso, run) => {
    const actor = await soleAdmin();
    const error = await asStaff(actor, () => run(service, actor)).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'LAST_ACTIVE_ADMIN' });
    expect((error as { getStatus(): number }).getStatus()).toBe(409);
    expect(await activeAdmins(ds)).toEqual([actor.id]);
    const roles = (await ds.query(`SELECT role::text FROM user_roles WHERE user_id = $1 ORDER BY role`, [
      actor.id,
    ])) as Array<{ role: string }>;
    expect(roles.map((r) => r.role)).toEqual(['ADMIN', 'DPO']);
  });
});
