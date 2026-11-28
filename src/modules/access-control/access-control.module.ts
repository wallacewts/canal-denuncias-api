import { Module } from '@nestjs/common';
import { AuditPolicy } from './policies/audit.policy.js';
import { CatalogPolicy } from './policies/catalog.policy.js';
import { DashboardPolicy } from './policies/dashboard.policy.js';
import { IdentityRevealPolicy } from './policies/identity-reveal.policy.js';
import { ReportsPolicy } from './policies/reports.policy.js';
import { RetentionPolicy } from './policies/retention.policy.js';
import { SettingsPolicy } from './policies/settings.policy.js';
import { UsersPolicy } from './policies/users.policy.js';

const POLICIES = [
  UsersPolicy,
  ReportsPolicy,
  IdentityRevealPolicy,
  RetentionPolicy,
  SettingsPolicy,
  CatalogPolicy,
  AuditPolicy,
  DashboardPolicy,
];

/**
 * Políticas de autorização (D54) sobre o catálogo único de habilidades (D55) e a função de escopo única (D60). O
 * pacote descobre as políticas registradas aqui em qualquer rota: um módulo não precisa importar este só para usar
 * `@Can()` (o `AuditModule` não importa, para não fechar ciclo com o acesso a denúncias, que usa a trilha).
 */
@Module({ providers: POLICIES, exports: POLICIES })
export class AccessControlModule {}
