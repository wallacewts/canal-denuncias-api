import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { Env } from './config/env.schema.js';
import { validateEnv } from './config/env.validate.js';
import { LOG_DESTINATION } from './config/log-destination.js';
import { buildLoggerParams } from './config/logger.config.js';
import { buildDataSourceOptions } from './database/database.options.js';
import { AuthInfraModule } from './infra/auth/auth-infra.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { StorageModule } from './infra/storage/storage.module.js';
import { VaultModule } from './infra/vault/vault.module.js';
import { AccessControlModule } from './modules/access-control/access-control.module.js';
import { AttachmentsModule } from './modules/attachments/attachments.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CaseManagementModule } from './modules/case-management/case-management.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CryptoModule } from './modules/crypto/crypto.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdentityVaultModule } from './modules/identity-vault/identity-vault.module.js';
import { MessagesModule } from './modules/messages/messages.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PublicTrackingModule } from './modules/public-tracking/public-tracking.module.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { RetentionModule } from './modules/retention/retention.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      // null em produção (stdout). Os testes substituem por um stream em memória.
      providers: [{ provide: LOG_DESTINATION, useValue: null }],
      inject: [ConfigService, LOG_DESTINATION],
      useFactory: (config: ConfigService<Env, true>, destination: DestinationStream | null) =>
        buildLoggerParams(
          {
            NODE_ENV: config.get('NODE_ENV', { infer: true }),
            LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
          },
          destination ?? undefined,
        ),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildDataSourceOptions(
          config.get('DATABASE_URL', { infer: true }),
          config.get('DATABASE_SSL', { infer: true }),
        ),
    }),
    HealthModule,
    VaultModule,
    AuthInfraModule,
    QueueModule,
    StorageModule,
    CryptoModule,
    AuditModule,
    UsersModule,
    AuthModule,
    AccessControlModule,
    CatalogModule,
    ReportsModule,
    PublicTrackingModule,
    CaseManagementModule,
    MessagesModule,
    AttachmentsModule,
    IdentityVaultModule,
    NotificationsModule,
    RetentionModule,
    ReportingModule,
  ],
})
export class AppModule {}
