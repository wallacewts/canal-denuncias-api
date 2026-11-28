import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PasswordHasher, SessionService } from '@nestjs/authentication';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { Role } from '../../common/enums/role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import { DomainConflictError } from '../../common/http/domain-error.js';
import type { Page, PageQuery } from '../../common/pagination/page.schema.js';
import type { StaffUser } from '../../infra/auth/staff-user.js';
import { PgMfaStore } from '../../infra/auth/stores/pg-mfa.store.js';
import { AuditAction, AuditResourceType } from '../audit/audit-action.enum.js';
import { AuditService } from '../audit/audit.service.js';
import { ADMIN_LOCK } from './admin-lock.js';
import { generateTemporaryPassword } from './temporary-password.js';
import type { CreateUserInput, ListUsersQuery } from './users.schemas.js';
import { UsersRepository, type LockedUser } from './users.repository.js';
import { sortRoles, toStaffUserView, type StaffUserView } from './users.view.js';

/** Operações de equipe (feature 005). Auditoria sempre na transação da alteração; ator vem do contexto (D46). */
@Injectable()
export class UsersService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly users: UsersRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly mfa: PgMfaStore,
  ) {}

  private readonly logger = new Logger(UsersService.name);

  /** Cadastro com senha provisória (R5): hash antes da transação; a senha só sai nesta resposta. */
  async create(actor: StaffUser, input: CreateUserInput): Promise<{ user: StaffUserView; temporaryPassword: string }> {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.hasher.hash(temporaryPassword);
    const roles = sortRoles(input.roles);
    const user = await this.ds.transaction(async (m) => {
      const created = await this.users.createWithRoles(
        { name: input.name, email: input.email, passwordHash, roles, grantedById: actor.id },
        m,
      );
      await this.audit.record(
        {
          action: AuditAction.USER_CREATED,
          resourceType: AuditResourceType.USER,
          resourceId: created.id,
          result: AuditResult.SUCCESS,
          metadata: { roles },
        },
        m,
      );
      return created;
    });
    return { user: toStaffUserView(user), temporaryPassword };
  }

  async list(query: ListUsersQuery): Promise<Page<StaffUserView>> {
    const { status, role, ...page } = query;
    const result = await this.users.listPage({ status, role }, page as PageQuery);
    return { items: result.items.map(toStaffUserView), nextCursor: result.nextCursor };
  }

  async get(id: string): Promise<StaffUserView> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('Pessoa não encontrada.');
    return toStaffUserView(user);
  }

  async updateName(actor: StaffUser, id: string, name: string): Promise<StaffUserView> {
    await this.mutate(actor, id, { adminLock: false }, async (m, target) => {
      if (target.name === name) return;
      await this.users.updateName(id, name, m);
      await this.record(AuditAction.USER_UPDATED, id, { fields: ['name'] }, m);
    });
    return this.get(id);
  }

  /**
   * Status (USERS-04): sair de `ACTIVE` revoga as sessões depois do commit; voltar revoga antes, para nenhuma sessão
   * antiga ressuscitar (R2). Desativar com denúncias abertas atribuídas é recusado (Q1). Bloquear nunca olha
   * atribuições.
   */
  async changeStatus(actor: StaffUser, id: string, status: UserStatus): Promise<StaffUserView> {
    if (status === UserStatus.ACTIVE) await this.sessions.revokeAll(id);
    const changed = await this.mutate(actor, id, { adminLock: true }, async (m, target) => {
      if (target.status === status) return false;
      if (status === UserStatus.DISABLED) await this.assertNoOpenAssignments(id, m);
      await this.users.updateStatus(id, status, m);
      await this.assertActiveAdminRemains(m);
      await this.record(AuditAction.USER_STATUS_CHANGED, id, { from: target.status, to: status }, m);
      return true;
    });
    if (changed && status !== UserStatus.ACTIVE) await this.revokeSessions(id);
    return this.get(id);
  }

  /** Perfis (USERS-05): vale na requisição seguinte (perfis relidos a cada requisição); sem revogar sessões. */
  async changeRoles(actor: StaffUser, id: string, roles: Role[]): Promise<StaffUserView> {
    const after = sortRoles(roles);
    await this.mutate(actor, id, { adminLock: true }, async (m, target) => {
      const before = sortRoles(target.roles);
      if (before.length === after.length && before.every((r, i) => r === after[i])) return;
      if (before.includes(Role.ANALYST) && !after.includes(Role.ANALYST)) await this.assertNoOpenAssignments(id, m);
      await this.users.replaceRoles(id, before, after, actor.id, m);
      await this.assertActiveAdminRemains(m);
      await this.record(AuditAction.USER_ROLES_CHANGED, id, { before, after }, m);
    });
    return this.get(id);
  }

  /**
   * Reset do MFA de outra pessoa (USERS-06, R6): autenticador e códigos apagados na transação do registro; as sessões
   * caem depois do commit. Idempotente: sem MFA, termina e registra do mesmo jeito.
   */
  async resetMfa(actor: StaffUser, id: string): Promise<void> {
    await this.mutate(actor, id, { adminLock: false }, async (m) => {
      await this.mfa.resetFor(id, m);
      await this.audit.record(
        {
          action: AuditAction.USER_MFA_RESET,
          resourceType: AuditResourceType.USER,
          resourceId: id,
          result: AuditResult.SUCCESS,
        },
        m,
      );
    });
    await this.revokeSessions(id);
  }

  /**
   * Transação de escrita sobre uma pessoa (R3): lock dos Administradores quando a operação pode reduzi-los, trava das
   * linhas de quem age e do alvo, e nova conferência de quem age (FR-011a): quem deixou de estar ativo ou de ser
   * Administrador desde o início da requisição não aplica nada (403).
   */
  private async mutate<T>(
    actor: StaffUser,
    targetId: string,
    { adminLock }: { adminLock: boolean },
    work: (m: EntityManager, target: LockedUser) => Promise<T>,
  ): Promise<T> {
    let actorRevoked = false;
    try {
      return await this.ds.transaction(async (m) => {
        if (adminLock) await m.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_LOCK]);
        const locked = await this.users.lockPair(actor.id, targetId, m);
        const current = locked.get(actor.id);
        if (current?.status !== UserStatus.ACTIVE || !current.roles.includes(Role.ADMIN)) {
          actorRevoked = true;
          throw new ForbiddenException();
        }
        const target = locked.get(targetId);
        if (!target) throw new NotFoundException('Pessoa não encontrada.');
        return work(m, target);
      });
    } finally {
      if (actorRevoked) {
        await this.audit.record({
          action: AuditAction.ACCESS_DENIED,
          resourceType: AuditResourceType.USER,
          resourceId: targetId,
          result: AuditResult.DENIED,
          metadata: { required: Role.ADMIN },
        });
      }
    }
  }

  private async assertNoOpenAssignments(id: string, m: EntityManager): Promise<void> {
    const assignedReports = await this.users.countOpenAssignedReports(id, m);
    if (assignedReports > 0) {
      throw new DomainConflictError(
        'USER_HAS_ASSIGNED_REPORTS',
        'A pessoa tem denúncias abertas atribuídas. Peça ao Gestor para reatribuí-las.',
        { assignedReports },
      );
    }
  }

  private async assertActiveAdminRemains(m: EntityManager): Promise<void> {
    if ((await this.users.countActiveAdmins(m)) === 0) {
      throw new DomainConflictError('LAST_ACTIVE_ADMIN', 'É preciso manter ao menos um Administrador ativo.');
    }
  }

  private async record(action: AuditAction, id: string, metadata: Record<string, unknown>, m: EntityManager) {
    await this.audit.record(
      { action, resourceType: AuditResourceType.USER, resourceId: id, result: AuditResult.SUCCESS, metadata },
      m,
    );
  }

  /** Depois do commit: o acesso já caiu (o status é relido a cada requisição); aqui as sessões são apagadas. */
  private async revokeSessions(id: string): Promise<void> {
    try {
      await this.sessions.revokeAll(id);
    } catch (error) {
      this.logger.error(
        { err: { type: error instanceof Error ? error.name : typeof error } },
        'Falha ao revogar sessões',
      );
    }
  }
}
