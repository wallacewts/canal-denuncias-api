import { applyDecorators, Controller, SetMetadata, UseInterceptors } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import { NoStoreInterceptor } from './no-store.interceptor.js';

export const API_AREA_METADATA = 'canal:api-area';
export const ADMIN_OPEN_METADATA = 'canal:admin-open';
export type ApiArea = 'public' | 'admin';

/**
 * Controller da área do denunciante: `/api/public/v1/<recurso>` (o prefixo `api` vem do `setupApp`).
 * Sem cookie, sem cache e verificada pelo teste de convenção (test/conventions/public-routes.e2e-spec.ts):
 * o único parâmetro de caminho permitido é `:attachmentId`. Protocolo, chave e dados pessoais vão no corpo.
 * Compõe `@Public()`: os guards globais de autenticação e autorização não leem nem exigem credencial aqui (R4).
 */
export function PublicApi(resource: string): ClassDecorator {
  return applyDecorators(
    Controller(`public/v1/${resource}`),
    ApiTags('public'),
    SetMetadata(API_AREA_METADATA, 'public'),
    Public(),
    UseInterceptors(NoStoreInterceptor),
  );
}

/**
 * Controller da área da equipe: `/api/admin/v1/<recurso>`, sem cache. Autenticada só pela sessão por cookie (D53) e
 * negada por padrão pela autorização (D54): toda rota declara `@Can()` ou `@Can.Anyone()`.
 */
export function AdminApi(resource: string): ClassDecorator {
  return applyDecorators(
    Controller(`admin/v1/${resource}`),
    ApiTags('admin'),
    SetMetadata(API_AREA_METADATA, 'admin'),
    UseInterceptors(NoStoreInterceptor),
  );
}

/**
 * Rota administrativa aberta de propósito, antes de existir identidade: entrar e informar o segundo fator. Compõe
 * `@Public()` (o guard de autenticação não exige sessão) e a marca que o `AdminIdentityGuard` respeita. Use só nessas
 * rotas; qualquer outra rota administrativa exige sessão verificada.
 */
export function OpenAdminRoute(): MethodDecorator & ClassDecorator {
  return applyDecorators(Public(), SetMetadata(ADMIN_OPEN_METADATA, true));
}
