import { Get, HttpCode, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { AuthorizationService, Can } from '@nestjs/authorization';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AdminApi } from '../../../src/common/http/route-decorators.js';
import { uuid } from '../../../src/common/validation/schemas.js';
import type { StaffUser } from '../../../src/infra/auth/staff-user.js';
import { AccessControlModule } from '../../../src/modules/access-control/access-control.module.js';
import { IdentityRevealPolicy } from '../../../src/modules/access-control/policies/identity-reveal.policy.js';
import { ReportsPolicy } from '../../../src/modules/access-control/policies/reports.policy.js';
import { ReportAccessService } from '../../../src/modules/access-control/report-access.service.js';

/**
 * Rotas SÓ DE TESTE da feature 007 (nunca importadas por `src/`): fazem o que as rotas reais de denúncia vão fazer
 * (D62) — a habilidade declarada na rota, o escopo pelo `ReportAccessService.resolve` e a operação por `authorize()`.
 */
@AdminApi('report-access-fixture')
export class ReportAccessFixtureController {
  constructor(
    private readonly access: ReportAccessService,
    private readonly authorization: AuthorizationService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  /** Detalhe com conteúdo: 404 fora do escopo ou inexistente, 410 expurgada dentro do escopo. */
  @Get(':id')
  @Can(ReportsPolicy, 'readAny')
  async read(@CurrentUser() user: StaffUser, @Param('id', { schema: uuid() }) id: string) {
    const facts = await this.access.resolve(user, id, 'reports.read', { content: true });
    return { id: facts.reportId };
  }

  /** Tratar: alcança a leitura (senão 404) e precisa poder tratar (senão 403). */
  @Post(':id/treatment')
  @HttpCode(200)
  @Can(ReportsPolicy, 'treatAny')
  async treat(@CurrentUser() user: StaffUser, @Param('id', { schema: uuid() }) id: string) {
    const facts = await this.access.resolve(user, id, 'reports.read');
    await this.authorization.authorize(ReportsPolicy, 'treat', user, facts);
    return { ok: true };
  }

  /** Decidir um pedido de revelação: DPO, sem bloqueio e nunca sobre o próprio pedido (four-eyes). */
  @Post(':id/reveal-requests/:requestId/decision')
  @HttpCode(200)
  @Can(IdentityRevealPolicy, 'decideAny')
  async decide(
    @CurrentUser() user: StaffUser,
    @Param('id', { schema: uuid() }) id: string,
    @Param('requestId', { schema: uuid() }) requestId: string,
  ) {
    const facts = await this.access.resolve(user, id, 'reports.read');
    const [request] = (await this.ds.query(
      `SELECT requested_by_id::text AS "requestedById" FROM identity_reveal_requests WHERE id = $1 AND report_id = $2`,
      [requestId, id],
    )) as Array<{ requestedById: string }>;
    if (!request) throw new NotFoundException();
    await this.authorization.authorize(IdentityRevealPolicy, 'decide', user, facts, request);
    return { ok: true };
  }
}

@Module({ imports: [AccessControlModule], controllers: [ReportAccessFixtureController] })
export class ReportAccessFixtureModule {}
