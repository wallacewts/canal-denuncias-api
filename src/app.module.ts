import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { envSchema, type Env } from './config/env.schema.js';
import { buildLoggerParams } from './config/logger.config.js';
import { buildDataSourceOptions } from './database/database.options.js';
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
      validate: (raw) => envSchema.parse(raw),
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildLoggerParams({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
        }),
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
