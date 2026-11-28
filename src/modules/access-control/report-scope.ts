import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type { Role } from '../../common/enums/role.enum.js';
import { ABILITY_CATALOG, type Ability, type CatalogEntry } from './abilities.js';

/**
 * Função de escopo ÚNICA das denúncias (D54, D60, research R1 da feature 007): quem alcança quais denúncias em cada
 * habilidade por registro. O alcance de cada perfil vem só do `recordScope` do catálogo; daqui saem os dois
 * intérpretes da mesma regra — a decisão sobre um registro (`allowsReport`) e o filtro da listagem no `WHERE`
 * (`scopeReportsFor`) — e um teste exaustivo no Postgres prova que concordam. Bloqueio por conflito de interesse
 * (`report_access_blocks`) nega sempre, para qualquer perfil.
 */
export type ReportAbility = {
  [K in Ability]: (typeof ABILITY_CATALOG)[K]['scope'] extends 'record' ? K : never;
}[Ability];

export interface ReportScope {
  /** `all`: todas (menos as bloqueadas); `assigned`: só as atribuídas à pessoa (menos as bloqueadas); `none`: nenhuma. */
  kind: 'all' | 'assigned' | 'none';
  userId: string;
}

/** O que se sabe de uma denúncia para decidir o acesso, carregado sem ler nenhum conteúdo cifrado. */
export interface ReportAccessFacts {
  reportId: string;
  exists: boolean;
  assignedToId: string | null;
  blockedForUser: boolean;
  shreddedAt: Date | null;
}

interface ScopedUser {
  id: string;
  roles: readonly Role[];
}

/** União do alcance dos perfis da pessoa na habilidade: `all` vence `assigned`; sem perfil com a habilidade, `none`. */
export function reportScope(user: ScopedUser | null | undefined, ability: ReportAbility): ReportScope {
  if (!user) return { kind: 'none', userId: '' };
  const reach = (ABILITY_CATALOG[ability] as CatalogEntry).recordScope ?? {};
  const found = user.roles.map((role) => reach[role]);
  const kind = found.includes('all') ? 'all' : found.includes('assigned') ? 'assigned' : 'none';
  return { kind, userId: user.id };
}

/** Intérprete por registro: a mesma regra que `scopeReportsFor` aplica na consulta. */
export function allowsReport(scope: ReportScope, facts: ReportAccessFacts): boolean {
  if (scope.kind === 'none' || !facts.exists || facts.blockedForUser) return false;
  return scope.kind === 'all' || facts.assignedToId === scope.userId;
}

/**
 * Intérprete da consulta (ACL-03): aplica no `WHERE` da própria listagem o escopo de `reports.list` — nunca carrega
 * para filtrar depois (princípio IV). `alias` é o da tabela `reports` no query builder. Os parâmetros têm nome
 * reservado (`acl_scope_*`) para não colidir com os filtros e o cursor da listagem. Sem a habilidade: `FALSE`.
 */
export function scopeReportsFor<T extends ObjectLiteral>(
  user: ScopedUser | null | undefined,
  queryBuilder: SelectQueryBuilder<T>,
  alias = queryBuilder.alias,
): SelectQueryBuilder<T> {
  const scope = reportScope(user, 'reports.list');
  if (scope.kind === 'none') return queryBuilder.andWhere('FALSE');
  queryBuilder.andWhere(
    `NOT EXISTS (SELECT 1 FROM report_access_blocks acl_b WHERE acl_b.report_id = ${alias}.id AND acl_b.user_id = :acl_scope_user)`,
    { acl_scope_user: scope.userId },
  );
  if (scope.kind === 'assigned') {
    queryBuilder.andWhere(`${alias}.assigned_to_id = :acl_scope_user`, { acl_scope_user: scope.userId });
  }
  return queryBuilder;
}
