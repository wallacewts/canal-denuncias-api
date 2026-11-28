import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { StorageService } from './storage.service.js';

/** Storage S3-compatível dos anexos (TRV-06). O bucket só é criado automaticamente em desenvolvimento. */
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const client = new S3Client({
          endpoint: config.get('S3_ENDPOINT', { infer: true }),
          region: config.get('S3_REGION', { infer: true }),
          forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
          credentials: {
            accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
            secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
          },
        });
        return new StorageService(client, config.get('S3_BUCKET', { infer: true }), {
          createBucketOnInit: config.get('NODE_ENV', { infer: true }) === 'development',
        });
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
