import { Body, Get, HttpCode, Param, Patch, Post, Put, Query, type ExecutionContext } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { AdminApi } from '../../common/http/route-decorators.js';
import type { StaffUser } from '../../infra/auth/staff-user.js';
import { UsersPolicy } from '../access-control/policies/users.policy.js';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateNameSchema,
  updateRolesSchema,
  updateStatusSchema,
  userIdParam,
  type CreateUserInput,
  type ListUsersQuery,
} from './users.schemas.js';
import { UsersService } from './users.service.js';
import type { Role } from '../../common/enums/role.enum.js';
import type { UserStatus } from '../../common/enums/user-status.enum.js';

/** O alvo das operações sobre outra pessoa vem do caminho (a política recusa a própria pessoa, D21). */
const targetId = (context: ExecutionContext): readonly [string | undefined] => [
  context.switchToHttp().getRequest<{ params: { id?: string } }>().params.id,
];

/** Gestão da equipe pelo Administrador (USERS-02 a USERS-06, contracts/users-api.md). */
@AdminApi('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Can(UsersPolicy, 'manage')
  @Post()
  @HttpCode(201)
  create(@CurrentUser() actor: StaffUser, @Body({ schema: createUserSchema }) body: CreateUserInput) {
    return this.users.create(actor, body);
  }

  @Can(UsersPolicy, 'manage')
  @Get()
  list(@Query({ schema: listUsersQuerySchema }) query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Can(UsersPolicy, 'manage')
  @Get(':id')
  get(@Param('id', { schema: userIdParam }) id: string) {
    return this.users.get(id);
  }

  @Can(UsersPolicy, 'manage')
  @Patch(':id')
  updateName(
    @CurrentUser() actor: StaffUser,
    @Param('id', { schema: userIdParam }) id: string,
    @Body({ schema: updateNameSchema }) body: { name: string },
  ) {
    return this.users.updateName(actor, id, body.name);
  }

  @Can(UsersPolicy, 'actOnOther', targetId)
  @Put(':id/status')
  changeStatus(
    @CurrentUser() actor: StaffUser,
    @Param('id', { schema: userIdParam }) id: string,
    @Body({ schema: updateStatusSchema }) body: { status: UserStatus },
  ) {
    return this.users.changeStatus(actor, id, body.status);
  }

  @Can(UsersPolicy, 'actOnOther', targetId)
  @Put(':id/roles')
  changeRoles(
    @CurrentUser() actor: StaffUser,
    @Param('id', { schema: userIdParam }) id: string,
    @Body({ schema: updateRolesSchema }) body: { roles: Role[] },
  ) {
    return this.users.changeRoles(actor, id, body.roles);
  }

  @Can(UsersPolicy, 'actOnOther', targetId)
  @Post(':id/mfa-reset')
  @HttpCode(204)
  async resetMfa(@CurrentUser() actor: StaffUser, @Param('id', { schema: userIdParam }) id: string): Promise<void> {
    await this.users.resetMfa(actor, id);
  }
}
