import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import type { AuditAction, AuditResourceType } from './audit-action.enum.js';
import { AuditInterceptor } from './audit.interceptor.js';

export const AUDITED_METADATA = 'canal:audited';

/** Parâmetros de rota e query já validados. Nunca o corpo nem a resposta (FR-014). */
export type AuditIdResolver = (
  params: Record<string, string | undefined>,
  query: Record<string, unknown>,
) => string | null;

export interface AuditedOptions {
  action: AuditAction;
  resourceType: AuditResourceType;
  resolveId?: AuditIdResolver;
}

/**
 * Audita a rota sozinha (AUDIT-04): `SUCCESS` quando o handler termina, `DENIED` em 403 e `FAILURE` em qualquer outro
 * erro. Para leituras e casos simples; operações que alteram dados gravam com `AuditService.record()` na transação.
 * A ação precisa aceitar metadata vazia: o decorator não grava metadata.
 */
export function Audited(action: AuditAction, resourceType: AuditResourceType, resolveId?: AuditIdResolver) {
  return applyDecorators(
    SetMetadata(AUDITED_METADATA, { action, resourceType, resolveId } satisfies AuditedOptions),
    UseInterceptors(AuditInterceptor),
  );
}
