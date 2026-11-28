import { Module } from '@nestjs/common';
import { AuditModule } from '../modules/audit/audit.module.js';
import { AuthModule } from '../modules/auth/auth.module.js';
import { UsersModule } from '../modules/users/users.module.js';
import { CliOutput } from './cli-output.js';
import { CreateAdminCommand } from './create-admin.command.js';
import { PasswordPrompt } from './password-prompt.js';

/** Comandos da CLI administrativa e suas dependências. Importado pela CLI e pelos testes. */
@Module({
  imports: [UsersModule, AuthModule, AuditModule],
  providers: [CreateAdminCommand, PasswordPrompt, CliOutput],
})
export class CliCommandsModule {}
