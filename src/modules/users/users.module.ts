import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';

/** Usuários internos e perfis. */
@Module({
  imports: [TypeOrmModule.forFeature([User, UserRole])],
  exports: [TypeOrmModule],
})
export class UsersModule {}
