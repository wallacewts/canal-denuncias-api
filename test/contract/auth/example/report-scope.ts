import { Role } from '../../../../src/common/enums/role.enum.js';
import type { StaffUser } from '../../../../src/infra/auth/staff-user.js';

/**
 * Função de escopo ÚNICA (R6) SÓ DE TESTE: quem vê quais denúncias. A mesma definição gera o predicado da política
 * (`allows`) e a condição da consulta (`toSql`), para a regra não ser escrita duas vezes.
 * - Gestor de compliance e DPO: todas (o DPO só lê, D20);
 * - Analista: só as atribuídas a ele;
 * - em qualquer perfil, nunca as bloqueadas para ele por conflito de interesse.
 */
export interface ReportScope {
  all: boolean;
  assignedTo: string | null;
  excludeBlockedFor: string;
  none: boolean;
}

export interface ScopedReport {
  id: string;
  assignedToId: string | null;
  blockedUserIds: string[];
}

export function reportScope(user: StaffUser): ReportScope {
  const all = user.roles.includes(Role.COMPLIANCE_MANAGER) || user.roles.includes(Role.DPO);
  const analyst = user.roles.includes(Role.ANALYST);
  return { all, assignedTo: !all && analyst ? user.id : null, excludeBlockedFor: user.id, none: !all && !analyst };
}

export function allows(scope: ReportScope, report: ScopedReport): boolean {
  if (scope.none) return false;
  if (report.blockedUserIds.includes(scope.excludeBlockedFor)) return false;
  return scope.all || report.assignedToId === scope.assignedTo;
}

/** Condição para `FROM reports r`; os parâmetros começam na posição `first`. */
export function toSql(scope: ReportScope, first = 1): { where: string; params: unknown[] } {
  if (scope.none) return { where: 'FALSE', params: [] };
  const blockedParam = `$${first}`;
  const parts = [
    `NOT EXISTS (SELECT 1 FROM report_access_blocks b WHERE b.report_id = r.id AND b.user_id = ${blockedParam})`,
  ];
  const params: unknown[] = [scope.excludeBlockedFor];
  if (!scope.all) {
    parts.push(`r.assigned_to_id = $${first + 1}`);
    params.push(scope.assignedTo);
  }
  return { where: parts.join(' AND '), params };
}
