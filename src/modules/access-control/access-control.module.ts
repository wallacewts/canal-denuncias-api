import { Module } from '@nestjs/common';
import { UsersPolicy } from './policies/users.policy.js';

/** Políticas de autorização (D54) sobre o catálogo único de habilidades (D55). */
@Module({ providers: [UsersPolicy], exports: [UsersPolicy] })
export class AccessControlModule {}
