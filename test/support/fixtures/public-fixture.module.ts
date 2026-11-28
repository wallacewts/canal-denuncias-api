import { Get, Module, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AdminApi, PublicApi } from '../../../src/common/http/route-decorators.js';
import { uuid } from '../../../src/common/validation/schemas.js';

/** Rotas públicas só de teste: uma tenta definir cookie, outra usa o único parâmetro de caminho permitido. */
@PublicApi('fixtures')
class PublicFixtureController {
  @Get('cookie')
  cookie(@Res({ passthrough: true }) res: Response) {
    res.cookie('rastreio', 'nao-deveria-sair', { httpOnly: true });
    res.setHeader('Set-Cookie', 'outro=valor');
    return { ok: true };
  }

  @Get('attachments/:attachmentId')
  attachment(@Param('attachmentId', { schema: uuid() }) attachmentId: string) {
    return { attachmentId };
  }
}

/** Rota administrativa só de teste. */
@AdminApi('fixtures')
class AdminFixtureController {
  @Get('sensitive')
  sensitive() {
    return { ok: true };
  }
}

@Module({ controllers: [PublicFixtureController, AdminFixtureController] })
export class PublicFixtureModule {}
