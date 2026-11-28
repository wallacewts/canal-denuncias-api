import {
  type CallHandler,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { catchError, from, mergeMap, type Observable, throwError } from 'rxjs';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { AuditService } from './audit.service.js';
import { AUDITED_METADATA, type AuditedOptions } from './audited.decorator.js';

/** Resposta de sucesso trocada por 500 porque o registro falhou: não deve gerar um segundo registro. */
class AuditRecordFailed extends InternalServerErrorException {}

/** Interceptor do `@Audited`. Registra o resultado da rota sem o corpo nem a resposta (FR-013 a FR-015). */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditedOptions | undefined>(AUDITED_METADATA, context.getHandler());
    if (!options) return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    const record = (result: AuditResult) =>
      this.audit.record({
        action: options.action,
        resourceType: options.resourceType,
        resourceId: options.resolveId?.(request.params as Record<string, string | undefined>, request.query) ?? null,
        result,
      });

    return next.handle().pipe(
      mergeMap((value) =>
        from(
          record(AuditResult.SUCCESS).then(
            () => value,
            () => {
              // Leitura sensível sem registro viola o princípio V: não entrega o resultado. Sem detalhes no log.
              this.logger.error('Falha ao registrar a auditoria de uma rota.');
              throw new AuditRecordFailed();
            },
          ),
        ),
      ),
      catchError((error: unknown) => {
        if (error instanceof AuditRecordFailed) return throwError(() => error);
        const result = error instanceof ForbiddenException ? AuditResult.DENIED : AuditResult.FAILURE;
        return from(
          record(result).then(
            () => Promise.reject(error),
            () => {
              this.logger.error('Falha ao registrar a auditoria de uma rota.');
              return Promise.reject(error);
            },
          ),
        );
      }),
    );
  }
}
