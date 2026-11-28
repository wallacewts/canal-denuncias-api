import { StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { HttpExceptionFilter } from './common/http/http-exception.filter.js';
import { validationExceptionFactory } from './common/validation/validation-error.mapper.js';
import type { Env } from './config/env.schema.js';

export interface SetupAppOptions {
  /** Desligado nos testes, para não registrar um listener de sinal por app criado. */
  enableShutdownHooks?: boolean;
}

/**
 * Configuração única do app HTTP, usada por `main.ts` e pelos testes (`test/support/test-app.ts`),
 * para que os testes rodem com os mesmos prefixos, cabeçalhos, pipes e filtros de produção (FR-032).
 */
export function setupApp(app: NestExpressApplication, options: SetupAppOptions = {}): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.disable('x-powered-by');
  // A API roda atrás do proxy reverso. O IP real só é usado na auditoria de ações da equipe interna.
  app.set('trust proxy', 1);
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });

  // Rotas: /api/public/v1/* (denunciante, anônimo) e /api/admin/v1/* (equipe). Health checks fora do prefixo.
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(new StandardSchemaValidationPipe({ exceptionFactory: validationExceptionFactory }));

  if (options.enableShutdownHooks ?? true) {
    app.enableShutdownHooks();
  }

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Canal de Denúncias API').setVersion('0.1.0').addCookieAuth('session').build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
}
