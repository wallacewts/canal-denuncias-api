import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditContextInterceptor } from './audit-context.interceptor.js';
import { AuditController } from './audit.controller.js';
import { AuditQueryService } from './audit-query.service.js';
import { AuditVerifierService } from './audit-verifier.service.js';
import { AuditService } from './audit.service.js';
import { AuditLog } from './entities/audit-log.entity.js';

/** Trilha de auditoria imutável: contexto do ator por requisição, catálogo, consulta e verificação da cadeia. */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditQueryService,
    AuditVerifierService,
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
  ],
  exports: [TypeOrmModule, AuditService, AuditVerifierService],
})
export class AuditModule {}
