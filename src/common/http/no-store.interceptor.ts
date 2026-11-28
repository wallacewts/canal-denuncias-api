import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ServerResponse } from 'node:http';
import type { Observable } from 'rxjs';
import { API_AREA_METADATA, type ApiArea } from './route-decorators.js';

/**
 * Aplicado por `@PublicApi` e `@AdminApi` (TRV-07, FR-024, FR-025):
 * - toda resposta das duas áreas proíbe cache no navegador e em intermediários;
 * - nas rotas públicas, nenhum cookie sai: `Set-Cookie` é descartado mesmo que algo tente defini-lo,
 *   porque o token do denunciante viaja só no cabeçalho `Authorization`.
 */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<ServerResponse>();
    const area = this.reflector.getAllAndOverride<ApiArea | undefined>(API_AREA_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    if (area === 'public') {
      const setHeader = res.setHeader.bind(res);
      res.setHeader = ((name: string, value: number | string | readonly string[]) =>
        name.toLowerCase() === 'set-cookie' ? res : setHeader(name, value)) as ServerResponse['setHeader'];
      res.removeHeader('Set-Cookie');
    }

    return next.handle();
  }
}
