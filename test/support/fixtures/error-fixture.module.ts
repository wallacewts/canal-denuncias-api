import { Public } from '@nestjs/authentication';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

/** Texto que simula um relato. Nunca pode aparecer em resposta nem em log. */
export const RELATO_SECRETO = 'TEXTO-DO-RELATO-SECRETO-7f3a';

function dbError(code: string): QueryFailedError {
  return new QueryFailedError('INSERT INTO reports ...', [RELATO_SECRETO], {
    code,
    constraint: 'UQ_fixture_constraint',
    detail: `Key (protocol)=(${RELATO_SECRETO}) already exists.`,
  } as never);
}

/** Rotas só de teste que provocam cada tipo de erro. */
@Public()
@Controller('fixtures/errors')
class ErrorFixtureController {
  @Get(':kind')
  throwKind(@Param('kind') kind: string): never {
    switch (kind) {
      case 'bad-request':
        throw new BadRequestException('Dados inválidos');
      case 'unauthorized':
        throw new UnauthorizedException();
      case 'forbidden':
        throw new ForbiddenException();
      case 'not-found':
        throw new NotFoundException('Recurso não encontrado');
      case 'unique':
        throw dbError('23505');
      case 'fk':
        throw dbError('23503');
      case 'check':
        throw dbError('23514');
      default:
        throw new Error(`Falha ao processar o relato: ${RELATO_SECRETO}`);
    }
  }

  /** Recebe um corpo e falha: o corpo não pode ir para a resposta nem para o log. */
  @Post('echo')
  @HttpCode(200)
  echo(): never {
    throw new BadRequestException('Dados inválidos');
  }
}

@Module({ controllers: [ErrorFixtureController] })
export class ErrorFixtureModule {}
