import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecoveryCode } from './entities/recovery-code.entity.js';
import { Session } from './entities/session.entity.js';
import { passwordHasherProvider } from './password/password-hasher.provider.js';
import { PasswordHasher } from '@nestjs/authentication';
import { AuditModule } from '../audit/audit.module.js';
import { AuthController } from './auth.controller.js';
import { CredentialsService } from './credentials.service.js';
import { MeSecurityController } from './me-security.controller.js';
import { PasswordChangeService } from './password-change.service.js';
import { StaffCredentialsRepository } from './staff-credentials.repository.js';

/**
 * Login da equipe (feature 006, D57): entrada com senha, desafio do segundo fator, bloqueio progressivo e saída, sobre
 * o `@nestjs/authentication` e os stores da feature 004. Sem renovação por tokens (D53).
 */
@Module({
  imports: [TypeOrmModule.forFeature([RecoveryCode, Session]), AuditModule],
  controllers: [AuthController, MeSecurityController],
  providers: [passwordHasherProvider, StaffCredentialsRepository, CredentialsService, PasswordChangeService],
  exports: [TypeOrmModule, PasswordHasher],
})
export class AuthModule {}
