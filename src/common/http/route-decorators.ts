import { applyDecorators, Controller, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NoStoreInterceptor } from './no-store.interceptor.js';

export const API_AREA_METADATA = 'canal:api-area';
export type ApiArea = 'public' | 'admin';

/**
 * Controller da área do denunciante: `/api/public/v1/<recurso>` (o prefixo `api` vem do `setupApp`).
 * Sem cookie, sem cache e verificada pelo teste de convenção (test/conventions/public-routes.e2e-spec.ts):
 * o único parâmetro de caminho permitido é `:attachmentId`. Protocolo, chave e dados pessoais vão no corpo.
 */
export function PublicApi(resource: string): ClassDecorator {
  return applyDecorators(
    Controller(`public/v1/${resource}`),
    ApiTags('public'),
    SetMetadata(API_AREA_METADATA, 'public'),
    UseInterceptors(NoStoreInterceptor),
  );
}

/**
 * Controller da área da equipe: `/api/admin/v1/<recurso>`, sem cache. A declaração de permissão por rota passa a ser
 * obrigatória com o módulo access-control (ACL-02).
 */
export function AdminApi(resource: string): ClassDecorator {
  return applyDecorators(
    Controller(`admin/v1/${resource}`),
    ApiTags('admin'),
    SetMetadata(API_AREA_METADATA, 'admin'),
    UseInterceptors(NoStoreInterceptor),
  );
}
