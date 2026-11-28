import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, type EntityManager } from 'typeorm';
import { paginate } from '../../common/pagination/cursor.js';
import type { Page, PageQuery } from '../../common/pagination/page.schema.js';
import { DomainConflictError } from '../../common/http/domain-error.js';
import type { Role } from '../../common/enums/role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';

export class EmailAlreadyRegisteredError extends DomainConflictError {
  constructor() {
    super('EMAIL_ALREADY_REGISTERED', 'E-mail já cadastrado.');
    this.name = 'EmailAlreadyRegisteredError';
  }
}

export interface NewUser {
  name: string;
  email: string;
  passwordHash: string;
  roles: Role[];
  /** Quem concedeu os perfis (nulo no `create-admin`). */
  grantedById?: string | null;
}

export interface UserListFilters {
  status?: UserStatus;
  role?: Role;
}

/**
 * Repositório de usuários (USERS-01). `findCredentialsByEmail` é o único método que lê `password_hash`. Os demais
 * devolvem o usuário com os perfis, sem hash nem segredo de MFA (colunas `select: false`).
 */
@Injectable()
export class UsersRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private manager(manager?: EntityManager): EntityManager {
    return manager ?? this.dataSource.manager;
  }

  async findById(id: string, manager?: EntityManager): Promise<User | null> {
    return this.manager(manager).findOne(User, { where: { id }, relations: { roles: true } });
  }

  async findCredentialsByEmail(email: string): Promise<{ user: User; passwordHash: string } | null> {
    const row = await this.dataSource.manager
      .createQueryBuilder(User, 'user')
      .addSelect('user.passwordHash')
      .leftJoinAndSelect('user.roles', 'role')
      .where('user.email = :email', { email })
      .getOne();
    if (!row) return null;
    const { passwordHash, ...user } = row;
    return { user: Object.assign(new User(), user, { passwordHash: undefined }), passwordHash };
  }

  /** Cria usuário e perfis numa transação. E-mail repetido é detectado pela constraint (409), sem consulta prévia. */
  async createWithRoles(data: NewUser, manager?: EntityManager): Promise<User> {
    const work = async (m: EntityManager) => {
      const inserted = await m.insert(User, {
        name: data.name,
        email: data.email,
        passwordHash: data.passwordHash,
        status: UserStatus.ACTIVE,
      });
      const id = (inserted.identifiers[0] as { id: string }).id;
      if (data.roles.length > 0) {
        await m.insert(
          UserRole,
          data.roles.map((role) => ({ userId: id, role, grantedById: data.grantedById ?? null })),
        );
      }
      return (await this.findById(id, m))!;
    };

    try {
      return manager ? await work(manager) : await this.dataSource.transaction(work);
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505') {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
  }

  async countActiveAdmins(manager?: EntityManager): Promise<number> {
    return this.manager(manager)
      .createQueryBuilder(UserRole, 'role')
      .innerJoin('role.user', 'user')
      .where('role.role = :role', { role: 'ADMIN' })
      .andWhere('user.status = :status', { status: UserStatus.ACTIVE })
      .getCount();
  }

  /** Página da equipe por cursor (TRV-08). O filtro de perfil é subconsulta: junção com `LIMIT` cortaria perfis. */
  async listPage(filters: UserListFilters, page: PageQuery): Promise<Page<User>> {
    const qb = this.dataSource.manager.createQueryBuilder(User, 'user');
    if (filters.status) qb.andWhere('user.status = :status', { status: filters.status });
    if (filters.role) {
      qb.andWhere('EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = user.id AND r.role = :role)', {
        role: filters.role,
      });
    }
    const result = await paginate(qb, page);
    const roles = await this.rolesOf(result.items.map((u) => u.id));
    for (const user of result.items) user.roles = roles.get(user.id) ?? [];
    return result;
  }

  private async rolesOf(ids: string[]): Promise<Map<string, UserRole[]>> {
    const map = new Map<string, UserRole[]>();
    if (ids.length === 0) return map;
    const rows = await this.dataSource.manager.find(UserRole, { where: { userId: In(ids) } });
    for (const row of rows) map.set(row.userId, [...(map.get(row.userId) ?? []), row]);
    return map;
  }

  /**
   * Trava as linhas de quem age e do alvo numa só consulta, em ordem de id (`FOR UPDATE`): duas pessoas agindo uma
   * sobre a outra não entram em impasse. Devolve status e perfis já confirmados (feature 005, research R3).
   */
  async lockPair(actorId: string, targetId: string, manager: EntityManager): Promise<Map<string, LockedUser>> {
    const rows = (await manager.query(
      `SELECT id::text AS id, name, status::text AS status FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [[actorId, targetId]],
    )) as Array<{ id: string; name: string; status: UserStatus }>;
    const roles = (await manager.query(
      `SELECT user_id::text AS "userId", role::text AS role FROM user_roles WHERE user_id = ANY($1::uuid[])`,
      [[actorId, targetId]],
    )) as Array<{ userId: string; role: Role }>;
    const result = new Map<string, LockedUser>();
    for (const row of rows) {
      result.set(row.id, { ...row, roles: roles.filter((r) => r.userId === row.id).map((r) => r.role) });
    }
    return result;
  }

  /** Denúncias abertas atribuídas (as encerradas guardam o analista só como histórico). */
  async countOpenAssignedReports(userId: string, manager: EntityManager): Promise<number> {
    const [row] = (await manager.query(
      `SELECT count(*)::int AS n FROM reports
        WHERE assigned_to_id = $1 AND status NOT IN ('CONCLUDED', 'INVALID', 'ARCHIVED')`,
      [userId],
    )) as Array<{ n: number }>;
    return row.n;
  }

  async updateName(id: string, name: string, manager: EntityManager): Promise<void> {
    await manager.update(User, { id }, { name });
  }

  async updateStatus(id: string, status: UserStatus, manager: EntityManager): Promise<void> {
    await manager.update(User, { id }, { status });
  }

  /** Troca o conjunto de perfis mantendo os que continuam (com quem concedeu e quando). */
  async replaceRoles(id: string, before: Role[], after: Role[], grantedById: string, manager: EntityManager) {
    const removed = before.filter((r) => !after.includes(r));
    const added = after.filter((r) => !before.includes(r));
    if (removed.length > 0) await manager.delete(UserRole, { userId: id, role: In(removed) });
    if (added.length > 0)
      await manager.insert(
        UserRole,
        added.map((role) => ({ userId: id, role, grantedById })),
      );
  }
}

export interface LockedUser {
  id: string;
  name: string;
  status: UserStatus;
  roles: Role[];
}
