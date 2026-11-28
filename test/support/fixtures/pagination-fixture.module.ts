import { Controller, Get, Module, Query } from '@nestjs/common';
import { TypeOrmModule, InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { paginate } from '../../../src/common/pagination/cursor.js';
import { pageQuerySchema, type PageQuery } from '../../../src/common/pagination/page.schema.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';

/** Rota só de teste que pagina a tabela de categorias. */
@Controller('fixtures/pagination')
class PaginationFixtureController {
  constructor(@InjectRepository(Category) private readonly categories: Repository<Category>) {}

  @Get('categories')
  list(@Query({ schema: pageQuerySchema }) query: PageQuery) {
    return paginate(this.categories.createQueryBuilder('category'), query);
  }
}

@Module({ imports: [TypeOrmModule.forFeature([Category])], controllers: [PaginationFixtureController] })
export class PaginationFixtureModule {}
