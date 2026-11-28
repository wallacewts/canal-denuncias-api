import { Get, HttpCode, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { AuthorizationService, Can } from '@nestjs/authorization';
import { AdminApi } from '../../../../src/common/http/route-decorators.js';
import type { StaffUser } from '../../../../src/infra/auth/staff-user.js';
import { ExamplePolicy } from './example.policy.js';
import { ExampleReportRepository } from './example.repository.js';

/** Rotas de exemplo SÓ DE TESTE para a autorização (US3): uma sem regra, regras por perfil e por registro. */
@AdminApi('example-admin')
export class ExampleAdminController {
  constructor(
    private readonly reports: ExampleReportRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Sem regra declarada: negada por padrão. */
  @Get('no-rule')
  noRule() {
    return { ok: true };
  }

  @Can(ExamplePolicy, 'manage')
  @Get('manager-only')
  managerOnly() {
    return { ok: true };
  }

  @Can(ExamplePolicy, 'list')
  @Get('reports')
  async list(@CurrentUser() user: StaffUser) {
    return { ids: await this.reports.findVisibleTo(user) };
  }

  @Can.Anyone()
  @Get('reports/:id')
  async read(@CurrentUser() user: StaffUser, @Param('id') id: string) {
    const report = await this.reports.findForCheck(id);
    if (!report) throw new NotFoundException();
    await this.authorization.authorize(ExamplePolicy, 'read', user, report);
    return { id };
  }

  @Can.Anyone()
  @Post('reports/:id/treat')
  @HttpCode(200)
  async treat(@CurrentUser() user: StaffUser, @Param('id') id: string) {
    const report = await this.reports.findForCheck(id);
    if (!report) throw new NotFoundException();
    await this.authorization.authorize(ExamplePolicy, 'treat', user, report);
    return { treated: id };
  }

  @Can(ExamplePolicy, 'changeRoles', (context) => [
    context.switchToHttp().getRequest<{ params: { id: string } }>().params.id,
  ])
  @Put('users/:id/roles')
  @HttpCode(204)
  changeRoles() {
    return;
  }
}
