import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './entities/category.entity.js';
import { Setting } from './entities/setting.entity.js';

/** Categorias, SLAs e configurações. */
@Module({
  imports: [TypeOrmModule.forFeature([Category, Setting])],
  exports: [TypeOrmModule],
})
export class CatalogModule {}
