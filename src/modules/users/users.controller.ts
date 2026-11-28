import { Body, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { AdminApi } from '../../common/http/route-decorators.js';
import type { StaffUser } from '../../infra/auth/staff-user.js';
import { UsersPolicy } from '../access-control/policies/users.policy.js';
import {
  createUserSchema,
  listUsersQuerySchema,
  userIdParam,
  type CreateUserInput,
  type ListUsersQuery,
} from './users.schemas.js';
import { UsersService } from './users.service.js';

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
}
