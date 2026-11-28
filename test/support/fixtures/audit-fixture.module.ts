import { ForbiddenException, Get, InternalServerErrorException, Module, Param } from '@nestjs/common';
import { AdminApi, PublicApi } from '../../../src/common/http/route-decorators.js';
import { uuid } from '../../../src/common/validation/schemas.js';

/**
 * Rotas só de teste da feature 003 (auditoria). As histórias acrescentam aqui as rotas que registram ações
 * (contexto do ator, @Audited).
 */
@PublicApi('audit-fixtures')
export class PublicAuditFixtureController {
  @Get('attachments/:attachmentId')
  read(@Param('attachmentId', { schema: uuid() }) attachmentId: string) {
    return { attachmentId };
  }
}

@AdminApi('audit-fixtures')
export class AdminAuditFixtureController {
  @Get('items/:id')
  read(@Param('id', { schema: uuid() }) id: string) {
    return { id };
  }

  @Get('forbidden/:id')
  forbidden(@Param('id', { schema: uuid() }) _id: string) {
    throw new ForbiddenException();
  }

  @Get('broken/:id')
  broken(@Param('id', { schema: uuid() }) _id: string) {
    throw new InternalServerErrorException();
  }
}

@Module({ controllers: [PublicAuditFixtureController, AdminAuditFixtureController] })
export class AuditFixtureModule {}
