import { PasswordHasher } from '@nestjs/authentication';
import { InjectDataSource } from '@nestjs/typeorm';
import { Command, CommandRunner, Option } from 'nest-commander';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import { AuditResult } from '../common/enums/audit-result.enum.js';
import { Role } from '../common/enums/role.enum.js';
import { AuditAction, AuditResourceType } from '../modules/audit/audit-action.enum.js';
import { runAsSystem } from '../modules/audit/audit-context.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { checkPasswordPolicy } from '../modules/auth/password/password-policy.js';
import { ADMIN_LOCK } from '../modules/users/admin-lock.js';
import { EmailAlreadyRegisteredError, UsersRepository } from '../modules/users/users.repository.js';
import { CliOutput } from './cli-output.js';
import { PasswordPrompt } from './password-prompt.js';

export interface CreateAdminOptions {
  name: string;
  email: string;
  force: boolean;
}

const MAX_ATTEMPTS = 3;

const optionsSchema = z.object({ name: z.string().trim().min(1).max(120), email: z.email().max(254) });

/**
 * `create-admin` (TRV-09, contracts/cli-create-admin.md): cria o primeiro administrador sem senha em migration,
 * argumento ou variável de ambiente. Usuário, perfil e auditoria `USER_CREATED` na mesma transação.
 */
@Command({
  name: 'create-admin',
  description: 'Cria o primeiro administrador. A senha é pedida no terminal, sem eco.',
})
export class CreateAdminCommand extends CommandRunner {
  constructor(
    private readonly users: UsersRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly prompt: PasswordPrompt,
    private readonly output: CliOutput,
  ) {
    super();
  }

  async run(_params: string[], options: CreateAdminOptions): Promise<void> {
    process.exitCode = await this.execute({ ...options, force: options.force ?? false });
  }

  @Option({ flags: '--name <name>', description: 'Nome do administrador', required: true })
  parseName(value: string): string {
    return value;
  }

  @Option({ flags: '--email <email>', description: 'E-mail de login', required: true })
  parseEmail(value: string): string {
    return value;
  }

  @Option({ flags: '--force', description: 'Cria mesmo que já exista um administrador ativo (auditado)' })
  parseForce(): boolean {
    return true;
  }

  /** Executa o comando com ator sistema na auditoria (D46) e devolve o código de saída (0 sucesso, 1 recusa). */
  execute(options: CreateAdminOptions): Promise<number> {
    return runAsSystem(() => this.executeAsSystem(options));
  }

  private async executeAsSystem(options: CreateAdminOptions): Promise<number> {
    const parsed = optionsSchema.safeParse(options);
    if (!parsed.success) {
      this.output.error('Informe um nome (até 120 caracteres) e um e-mail válido.');
      return 1;
    }
    const { name, email } = parsed.data;

    const password = await this.askPassword();
    if (password === null) return 1;
    const passwordHash = await this.hasher.hash(password);

    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_LOCK]);
        if (!options.force && (await this.users.countActiveAdmins(manager)) > 0) {
          this.output.error('Já existe um administrador ativo. Use --force para criar outro (a criação é auditada).');
          return 1;
        }
        const user = await this.users.createWithRoles({ name, email, passwordHash, roles: [Role.ADMIN] }, manager);
        await this.audit.record(
          {
            action: AuditAction.USER_CREATED,
            resourceType: AuditResourceType.USER,
            resourceId: user.id,
            result: AuditResult.SUCCESS,
            metadata: { roles: [Role.ADMIN], forced: options.force },
          },
          manager,
        );
        this.output.info('Administrador criado. O cadastro do segundo fator será exigido no primeiro login.');
        return 0;
      });
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        this.output.error('E-mail já cadastrado.');
        return 1;
      }
      throw error;
    }
  }

  private async askPassword(): Promise<string | null> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const password = await this.prompt.ask('Senha: ');
      const policy = checkPasswordPolicy(password);
      if (!policy.ok) {
        this.output.error(policy.message);
        continue;
      }
      const confirmation = await this.prompt.ask('Confirme a senha: ');
      if (confirmation !== password) {
        this.output.error('As senhas não conferem.');
        continue;
      }
      return password;
    }
    this.output.error(`Número máximo de tentativas (${MAX_ATTEMPTS}) atingido.`);
    return null;
  }
}
