import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';
import { LastLoginSubscriber } from './last-login.subscriber.js';
import { MeController } from './me.controller.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

/** Usuários internos e perfis (USERS-01 a USERS-07). */
@Module({
  imports: [TypeOrmModule.forFeature([User, UserRole]), AuditModule, AuthModule, AccessControlModule],
  controllers: [UsersController, MeController],
  providers: [UsersRepository, UsersService, LastLoginSubscriber],
  exports: [TypeOrmModule, UsersRepository],
})
export class UsersModule {}
