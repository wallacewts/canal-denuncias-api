import { Module } from '@nestjs/common';
import { AuditModule } from '../modules/audit/audit.module.js';
import { AuthModule } from '../modules/auth/auth.module.js';
import { CryptoModule } from '../modules/crypto/crypto.module.js';
import { UsersModule } from '../modules/users/users.module.js';
import { AuditMaintenanceCommand } from './audit-maintenance.command.js';
import { CliOutput } from './cli-output.js';
import { CreateAdminCommand } from './create-admin.command.js';
import { PasswordPrompt } from './password-prompt.js';
import { RewrapKeysCommand } from './rewrap-keys.command.js';
import { VerifyAuditCommand } from './verify-audit.command.js';

/** Comandos da CLI administrativa e suas dependências. Importado pela CLI e pelos testes. */
@Module({
  imports: [UsersModule, AuthModule, AuditModule, CryptoModule],
  providers: [
    CreateAdminCommand,
    RewrapKeysCommand,
    VerifyAuditCommand,
    AuditMaintenanceCommand,
    PasswordPrompt,
    CliOutput,
  ],
})
export class CliCommandsModule {}
