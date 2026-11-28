import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditContextInterceptor } from './audit-context.interceptor.js';
import { AuditService } from './audit.service.js';
import { AuditLog } from './entities/audit-log.entity.js';

/** Trilha de auditoria imutável: contexto do ator por requisição, catálogo, consulta e verificação da cadeia. */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor }],
  exports: [TypeOrmModule, AuditService],
})
export class AuditModule {}
