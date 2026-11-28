import { RequestMethod, type INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { ADMIN_OPEN_METADATA, API_AREA_METADATA, STEP_ROUTE_METADATA } from '../../src/common/http/route-decorators.js';
import { POLICY_ABILITIES } from '../../src/modules/access-control/policy-abilities.js';

/**
 * Chaves onde os pacotes gravam as declarações. Não são exportadas por eles: o teste-sentinela
 * (`authorization-metadata.e2e-spec.ts`) quebra se mudarem.
 */
export const AUTHORIZATION_METADATA = {
  can: 'authorization:can',
  canAnyone: 'authorization:can-anyone',
  isPublic: Symbol.for('@nestjs/authentication:public'),
} as const;

/**
 * `@Can.Anyone()` só nestas rotas, cada uma com o motivo (D62): agem só sobre a própria pessoa da sessão. Rota nova
 * aqui exige justificativa na revisão; rota de denúncia nunca entra (declara a habilidade e usa o `resolve`).
 */
export const ANYONE_ALLOWED: Record<string, string> = {
  'GET /api/admin/v1/me': 'perfil da própria pessoa',
  'GET /api/admin/v1/me/sessions': 'sessões da própria pessoa',
  'DELETE /api/admin/v1/me/sessions/:id': 'encerra uma sessão da própria pessoa (404 para a de outra)',
  'DELETE /api/admin/v1/me/sessions': 'encerra todas as sessões da própria pessoa',
};

export interface AdminRoute {
  /** `MÉTODO /api/admin/v1/...`, com os parâmetros como no código (`:id`). */
  key: string;
  handler: string;
  policies: string[];
  anyone: boolean;
  /** Aberta pelo login: `OpenAdminRoute` (público) ou `StepRoute` (etapa). */
  loginRoute: boolean;
}

type Ctor = new (...args: never[]) => object;

/** Metadado do método, ou da classe quando o método não declara (o método vence a classe, como nos pacotes). */
function read<T>(key: string | symbol, handler: object, type: Ctor): T | undefined {
  const own = Reflect.getMetadata(key, handler) as T | undefined;
  return own !== undefined ? own : (Reflect.getMetadata(key, type) as T | undefined);
}

/** Rotas de todos os controllers `@AdminApi` registrados no app (exige `DiscoveryModule` importado). */
export function adminRoutes(app: INestApplication): AdminRoute[] {
  const discovery = app.get(DiscoveryService);
  const scanner = new MetadataScanner();
  const routes: AdminRoute[] = [];
  for (const wrapper of discovery.getControllers()) {
    const type = wrapper.metatype as Ctor | undefined;
    if (!type || Reflect.getMetadata(API_AREA_METADATA, type) !== 'admin') continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, type) ?? '');
    for (const name of scanner.getAllMethodNames(type.prototype)) {
      const handler = (type.prototype as Record<string, unknown>)[name] as object;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (path === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      const full = ['/api', base, path]
        .filter((p) => p && p !== '/')
        .join('/')
        .replace(/\/+/g, '/');
      const methodCan = (Reflect.getMetadata(AUTHORIZATION_METADATA.can, handler) ?? []) as Array<{
        policy: { name: string };
      }>;
      const classCan = (Reflect.getMetadata(AUTHORIZATION_METADATA.can, type) ?? []) as Array<{
        policy: { name: string };
      }>;
      routes.push({
        key: `${method} ${full}`,
        handler: `${type.name}.${name}`,
        policies: [...classCan, ...methodCan].map((r) => r.policy.name),
        anyone: Boolean(read<boolean>(AUTHORIZATION_METADATA.canAnyone, handler, type)),
        loginRoute:
          Boolean(read<boolean>(AUTHORIZATION_METADATA.isPublic, handler, type)) ||
          Boolean(read<boolean>(ADMIN_OPEN_METADATA, handler, type)) ||
          read<unknown>(STEP_ROUTE_METADATA, handler, type) !== undefined,
      });
    }
  }
  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Regra do ACL-05 (FR-021, D62): toda rota tem `@Can()` com política do mapa de habilidades, ou é aberta pelo login,
 * ou tem `@Can.Anyone()` e está na lista explícita. Devolve um problema por rota, nomeando-a.
 */
export function routeProblems(routes: AdminRoute[], anyoneAllowed: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const route of routes) {
    if (route.loginRoute) continue;
    if (route.policies.length > 0) {
      for (const policy of route.policies) {
        if (!Object.hasOwn(POLICY_ABILITIES, policy)) {
          problems.push(`${route.key}: política ${policy} fora do mapa de habilidades`);
        }
      }
      continue;
    }
    if (route.anyone) {
      if (!Object.hasOwn(anyoneAllowed, route.key)) problems.push(`${route.key}: @Can.Anyone() fora da lista`);
      continue;
    }
    problems.push(`${route.key}: sem declaração de permissão`);
  }
  return problems;
}
