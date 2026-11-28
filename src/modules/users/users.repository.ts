import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import type { Role } from '../../common/enums/role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';

export class EmailAlreadyRegisteredError extends ConflictException {
  constructor() {
    super('E-mail já cadastrado.');
    this.name = 'EmailAlreadyRegisteredError';
  }
}

export interface NewUser {
  name: string;
  email: string;
  passwordHash: string;
  roles: Role[];
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
          data.roles.map((role) => ({ userId: id, role })),
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
}
