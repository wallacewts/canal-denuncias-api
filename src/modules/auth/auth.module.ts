import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecoveryCode } from './entities/recovery-code.entity.js';
import { Session } from './entities/session.entity.js';
import { passwordHasherProvider } from './password/password-hasher.provider.js';
import { PasswordHasher } from '@nestjs/authentication';

/** Login, MFA TOTP, códigos de recuperação, refresh token com rotação, bloqueio progressivo. */
@Module({
  imports: [TypeOrmModule.forFeature([RecoveryCode, Session])],
  providers: [passwordHasherProvider],
  exports: [TypeOrmModule, PasswordHasher],
})
export class AuthModule {}
