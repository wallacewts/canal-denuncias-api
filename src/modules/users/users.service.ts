import { Injectable, NotFoundException } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import type { Page, PageQuery } from '../../common/pagination/page.schema.js';
import type { StaffUser } from '../../infra/auth/staff-user.js';
import { AuditAction, AuditResourceType } from '../audit/audit-action.enum.js';
import { AuditService } from '../audit/audit.service.js';
import { generateTemporaryPassword } from './temporary-password.js';
import type { CreateUserInput, ListUsersQuery } from './users.schemas.js';
import { UsersRepository } from './users.repository.js';
import { sortRoles, toStaffUserView, type StaffUserView } from './users.view.js';

/** Operações de equipe (feature 005). Auditoria sempre na transação da alteração; ator vem do contexto (D46). */
@Injectable()
export class UsersService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly users: UsersRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
  ) {}

  /** Cadastro com senha provisória (R5): hash antes da transação; a senha só sai nesta resposta. */
  async create(actor: StaffUser, input: CreateUserInput): Promise<{ user: StaffUserView; temporaryPassword: string }> {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.hasher.hash(temporaryPassword);
    const roles = sortRoles(input.roles);
    const user = await this.ds.transaction(async (m) => {
      const created = await this.users.createWithRoles(
        { name: input.name, email: input.email, passwordHash, roles, grantedById: actor.id },
        m,
      );
      await this.audit.record(
        {
          action: AuditAction.USER_CREATED,
          resourceType: AuditResourceType.USER,
          resourceId: created.id,
          result: AuditResult.SUCCESS,
          metadata: { roles },
        },
        m,
      );
      return created;
    });
    return { user: toStaffUserView(user), temporaryPassword };
  }

  async list(query: ListUsersQuery): Promise<Page<StaffUserView>> {
    const { status, role, ...page } = query;
    const result = await this.users.listPage({ status, role }, page as PageQuery);
    return { items: result.items.map(toStaffUserView), nextCursor: result.nextCursor };
  }

  async get(id: string): Promise<StaffUserView> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('Pessoa não encontrada.');
    return toStaffUserView(user);
  }
}
