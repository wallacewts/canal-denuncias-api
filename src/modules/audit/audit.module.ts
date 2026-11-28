import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditContextInterceptor } from './audit-context.interceptor.js';
import { AuditController } from './audit.controller.js';
import { AuditMaintenanceService } from './audit-maintenance.service.js';
import { AuditQueryService } from './audit-query.service.js';
import { AuditVerifierService } from './audit-verifier.service.js';
import { AuditService } from './audit.service.js';
import { AuditLog } from './entities/audit-log.entity.js';
import { AuditPurge } from './entities/audit-purge.entity.js';

/**
 * Trilha de auditoria imutável: contexto do ator por requisição, catálogo, consulta, verificação da cadeia e
 * manutenção das partições (expurgo de 5 anos).
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, AuditPurge])],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditQueryService,
    AuditVerifierService,
    AuditMaintenanceService,
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
  ],
  exports: [TypeOrmModule, AuditService, AuditVerifierService, AuditMaintenanceService],
})
export class AuditModule {}
