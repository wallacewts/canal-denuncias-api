import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attachment } from './entities/attachment.entity.js';

/** Upload, antivírus, remoção de metadados e storage S3 cifrado. */
@Module({
  imports: [TypeOrmModule.forFeature([Attachment])],
  exports: [TypeOrmModule],
})
export class AttachmentsModule {}
