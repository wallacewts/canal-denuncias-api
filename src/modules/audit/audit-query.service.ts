import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { z } from 'zod';
import type { ActorType } from '../../common/enums/actor-type.enum.js';
import type { AuditResult } from '../../common/enums/audit-result.enum.js';
import { decodeBigintCursor, paginateDesc } from '../../common/pagination/cursor-desc.js';
import { MAX_PAGE_SIZE, type Page } from '../../common/pagination/page.schema.js';
import { strictObject } from '../../common/validation/schemas.js';
import { AuditAction, AuditResourceType } from './audit-action.enum.js';
import { AUDIT_RESOURCE_ID } from './audit-metadata.schemas.js';
import { AuditLog } from './entities/audit-log.entity.js';

/** Filtros da consulta (contracts/admin-audit-api.md). Mensagens fixas, sem interpolar valores. */
export const auditLogQuerySchema = strictObject({
  actorUserId: z.uuid().optional(),
  action: z.enum(AuditAction).optional(),
  resourceType: z.enum(AuditResourceType).optional(),
  resourceId: AUDIT_RESOURCE_ID.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  after: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      const id = decodeBigintCursor(value);
      if (!id) {
        ctx.addIssue({ code: 'custom', message: 'Cursor inválido' });
        return z.NEVER;
      }
      return id;
    }),
}).refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), {
  message: 'Período inválido',
  path: ['to'],
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export interface AuditLogView {
  id: string;
  occurredAt: string;
  actorType: ActorType;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: AuditResult;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
}

export type AuditLogFilters = Omit<AuditLogQuery, 'limit' | 'after'>;

/** Consulta da trilha (AUDIT-06). Os filtros usam os índices existentes; o período descarta partições fora dele. */
@Injectable()
export class AuditQueryService {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  async list(query: AuditLogQuery): Promise<Page<AuditLogView>> {
    const qb = this.logs.createQueryBuilder('log');
    if (query.actorUserId) qb.andWhere('log.actorUserId = :actorUserId', { actorUserId: query.actorUserId });
    if (query.action) qb.andWhere('log.action = :action', { action: query.action });
    if (query.resourceType) qb.andWhere('log.resourceType = :resourceType', { resourceType: query.resourceType });
    if (query.resourceId) qb.andWhere('log.resourceId = :resourceId', { resourceId: query.resourceId });
    if (query.from) qb.andWhere('log.occurredAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('log.occurredAt <= :to', { to: query.to });
    const page = await paginateDesc(qb, { limit: query.limit, after: query.after });
    return { items: page.items.map(toView), nextCursor: page.nextCursor };
  }
}

/** Só os filtros informados, para a metadata de `AUDIT_LOG_VIEWED`. */
export function usedFilters(query: AuditLogQuery): AuditLogFilters {
  const { limit: _limit, after: _after, ...filters } = query;
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)) as AuditLogFilters;
}

function toView(log: AuditLog): AuditLogView {
  return {
    id: String(log.id),
    occurredAt: log.occurredAt.toISOString(),
    actorType: log.actorType,
    actorUserId: log.actorUserId,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    result: log.result,
    ip: log.ip,
    userAgent: log.userAgent,
    metadata: log.metadata,
  };
}
