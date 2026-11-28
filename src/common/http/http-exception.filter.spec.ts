import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  type ArgumentsHost,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { HttpExceptionFilter } from './http-exception.filter.js';

const SEGREDO = 'TEXTO-DO-RELATO-SECRETO';
const REQUEST_ID = '0b8f0e7a-6d3c-4d55-9a3e-2f1d7e4c9b10';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: unknown;
  requestId: string;
}

function run(exception: unknown, request: Record<string, unknown> = { id: REQUEST_ID }) {
  const res = { statusCode: 0, body: undefined as unknown as ErrorBody };
  const response = {
    status(code: number) {
      res.statusCode = code;
      return response;
    },
    json(body: ErrorBody) {
      res.body = body;
      return response;
    },
  };
  const req = { method: 'POST', url: '/api/x?y=1', body: { t: SEGREDO }, ...request };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return res;
}

function dbError(code: string) {
  return new QueryFailedError('INSERT INTO users ...', ['a@b.c', SEGREDO], {
    code,
    constraint: 'UQ_97672ac88f789774dd47f7c8be3',
    detail: `Key (email)=(a@b.c) already exists. ${SEGREDO}`,
    message: `duplicate key value violates unique constraint "UQ_97672ac88f789774dd47f7c8be3"`,
  } as never);
}

describe('HttpExceptionFilter', () => {
  it.each([
    [new BadRequestException('Dados inválidos'), 400, 'Bad Request'],
    [new UnauthorizedException(), 401, 'Unauthorized'],
    [new ForbiddenException(), 403, 'Forbidden'],
    [new NotFoundException('Denúncia não encontrada'), 404, 'Not Found'],
    [new ConflictException('Conflito'), 409, 'Conflict'],
  ])('responde %s no formato único', (exception, status, error) => {
    const { statusCode, body } = run(exception);
    expect(statusCode).toBe(status);
    expect(Object.keys(body).sort()).toEqual(['error', 'message', 'requestId', 'statusCode']);
    expect(body).toMatchObject({ statusCode: status, error, requestId: REQUEST_ID });
    expect(typeof body.message).toBe('string');
  });

  it('erro inesperado vira 500 com mensagem genérica, sem o texto original', () => {
    const { statusCode, body } = run(new Error(`Falha ao processar: ${SEGREDO}`));
    expect(statusCode).toBe(500);
    expect(body.error).toBe('Internal Server Error');
    expect(JSON.stringify(body)).not.toContain(SEGREDO);
  });

  it('5xx de HttpException também não repassa a mensagem original', () => {
    const { statusCode, body } = run(new ServiceUnavailableException(`detalhe interno ${SEGREDO}`));
    expect(statusCode).toBe(503);
    expect(JSON.stringify(body)).not.toContain(SEGREDO);
  });

  it('violação de unique (23505) vira 409 sem nome de constraint nem dados', () => {
    const { statusCode, body } = run(dbError('23505'));
    expect(statusCode).toBe(409);
    const text = JSON.stringify(body);
    expect(text).not.toContain('UQ_');
    expect(text).not.toContain('a@b.c');
    expect(text).not.toContain(SEGREDO);
  });

  it('violação de FK (23503) vira 409 sem nome de constraint', () => {
    const { statusCode, body } = run(dbError('23503'));
    expect(statusCode).toBe(409);
    expect(JSON.stringify(body)).not.toContain('UQ_');
  });

  it('violação de CHECK (23514) vira 500 genérico', () => {
    const { statusCode, body } = run(dbError('23514'));
    expect(statusCode).toBe(500);
    expect(JSON.stringify(body)).not.toContain('UQ_');
    expect(JSON.stringify(body)).not.toContain(SEGREDO);
  });

  it('erro de parse do corpo (JSON malformado) vira 400 com mensagem fixa, sem trecho do corpo', () => {
    const parseError = Object.assign(new SyntaxError(`Unexpected token 'T', "${SEGREDO}" is not valid JSON`), {
      status: 400,
      statusCode: 400,
      type: 'entity.parse.failed',
      body: SEGREDO,
      expose: true,
    });
    const { statusCode, body } = run(parseError);
    expect(statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(JSON.stringify(body)).not.toContain(SEGREDO);
  });

  it('erro de parse já convertido pelo Nest (BadRequestException com cause) também tem mensagem fixa', () => {
    const cause = Object.assign(new SyntaxError(`Unexpected token 'X', "${SEGREDO}" is not valid JSON`), {
      status: 400,
      type: 'entity.parse.failed',
    });
    const { statusCode, body } = run(new BadRequestException(cause.message, { cause }));
    expect(statusCode).toBe(400);
    expect(JSON.stringify(body)).not.toContain(SEGREDO);
  });

  it('URIError de parâmetro mal codificado (convertido pelo Nest) não repete o caminho', () => {
    const cause = Object.assign(new URIError(`Failed to decode param '%FF${SEGREDO}'`), { status: 400 });
    const { statusCode, body } = run(new BadRequestException(cause.message, { cause }));
    expect(statusCode).toBe(400);
    expect(JSON.stringify(body)).not.toContain(SEGREDO);
  });

  it('http-error de corpo grande (convertido pelo Nest) tem mensagem fixa', () => {
    const cause = Object.assign(new Error(`request entity too large ${SEGREDO}`), {
      statusCode: 413,
      status: 413,
      expose: true,
      type: 'entity.too.large',
    });
    const { statusCode, body } = run(new HttpException(cause.message, 413, { cause }));
    expect(statusCode).toBe(413);
    expect(JSON.stringify(body)).not.toContain(SEGREDO);
  });

  it('404 de rota inexistente não repete o caminho nem a query string', () => {
    const { statusCode, body } = run(new NotFoundException('Cannot GET /api/x?protocol=DV-SEGREDO'));
    expect(statusCode).toBe(404);
    expect(JSON.stringify(body)).not.toContain('DV-SEGREDO');
  });

  it('gera um requestId quando a requisição ainda não tem um', () => {
    const { body } = run(new BadRequestException(), { id: undefined });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
