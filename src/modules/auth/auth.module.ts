import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecoveryCode } from './entities/recovery-code.entity.js';
import { Session } from './entities/session.entity.js';

/** Login, MFA TOTP, códigos de recuperação, refresh token com rotação, bloqueio progressivo. */
@Module({
  imports: [TypeOrmModule.forFeature([RecoveryCode, Session])],
  exports: [TypeOrmModule],
})
export class AuthModule {}
