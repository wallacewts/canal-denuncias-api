import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.disable('x-powered-by');
  // A API roda atrás do proxy reverso. O IP real só é usado na auditoria de ações da equipe interna.
  app.set('trust proxy', 1);
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });

  // Rotas: /api/public/v1/* (denunciante, anônimo) e /api/admin/v1/* (equipe). Health checks fora do prefixo.
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });
  app.enableShutdownHooks();

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Canal de Denúncias API').setVersion('0.1.0').addCookieAuth('session').build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

await bootstrap();
