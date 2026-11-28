import { Body, ForbiddenException, Get, InternalServerErrorException, Module, Param, Post } from '@nestjs/common';
import { AuditResult } from '../../../src/common/enums/audit-result.enum.js';
import { AuditAction, AuditResourceType } from '../../../src/modules/audit/audit-action.enum.js';
import { AuditModule } from '../../../src/modules/audit/audit.module.js';
import { AuditService } from '../../../src/modules/audit/audit.service.js';
import { Audited } from '../../../src/modules/audit/audited.decorator.js';
import { strictObject, text } from '../../../src/common/validation/schemas.js';
import { AdminApi, PublicApi } from '../../../src/common/http/route-decorators.js';
import { uuid } from '../../../src/common/validation/schemas.js';

/**
 * Rotas só de teste da feature 003 (auditoria). As histórias acrescentam aqui as rotas que registram ações
 * (contexto do ator, @Audited).
 */
@PublicApi('audit-fixtures')
export class PublicAuditFixtureController {
  constructor(private readonly audit: AuditService) {}

  /** Registra uma ação numa rota pública: o ator vem do contexto, sem IP nem user-agent. */
  @Post('record')
  async record() {
    const row = await this.audit.record({
      action: AuditAction.REPORTER_REPORT_VIEWED,
      resourceType: AuditResourceType.REPORT,
      resourceId: null,
      result: AuditResult.SUCCESS,
    });
    return { id: row.id };
  }

  @Get('attachments/:attachmentId')
  read(@Param('attachmentId', { schema: uuid() }) attachmentId: string) {
    return { attachmentId };
  }
}

@AdminApi('audit-fixtures')
export class AdminAuditFixtureController {
  constructor(private readonly audit: AuditService) {}

  /** Registra uma ação numa rota administrativa: equipe, com o id da identidade e o IP real. */
  @Post('record/:id')
  async record(@Param('id', { schema: uuid() }) id: string) {
    const row = await this.audit.record({
      action: AuditAction.REPORT_VIEWED,
      resourceType: AuditResourceType.REPORT,
      resourceId: id,
      result: AuditResult.SUCCESS,
    });
    return { id: row.id };
  }

  @Get('items/:id')
  @Audited(AuditAction.REPORT_VIEWED, AuditResourceType.REPORT, (params) => params.id ?? null)
  read(@Param('id', { schema: uuid() }) id: string) {
    return { id, conteudo: 'resposta que nunca vai para a trilha' };
  }

  @Get('forbidden/:id')
  @Audited(AuditAction.REPORT_VIEWED, AuditResourceType.REPORT, (params) => params.id ?? null)
  forbidden(@Param('id', { schema: uuid() }) _id: string) {
    throw new ForbiddenException();
  }

  @Get('broken/:id')
  @Audited(AuditAction.REPORT_VIEWED, AuditResourceType.REPORT, (params) => params.id ?? null)
  broken(@Param('id', { schema: uuid() }) _id: string) {
    throw new InternalServerErrorException();
  }

  /** O corpo nunca vai para a trilha. */
  @Post('notes/:id')
  @Audited(AuditAction.INTERNAL_NOTES_VIEWED, AuditResourceType.REPORT, (params) => params.id ?? null)
  withBody(
    @Param('id', { schema: uuid() }) id: string,
    @Body({ schema: strictObject({ texto: text({ max: 50 }) }) }) _body: unknown,
  ) {
    return { id };
  }

  /** Força a gravação a falhar (identificador recusado pelo catálogo) depois de um handler bem-sucedido. */
  @Get('unrecordable')
  @Audited(AuditAction.REPORT_VIEWED, AuditResourceType.REPORT, () => 'id com espaço')
  unrecordable() {
    return { segredo: 'XQZ' };
  }
}

@Module({ imports: [AuditModule], controllers: [PublicAuditFixtureController, AdminAuditFixtureController] })
export class AuditFixtureModule {}
