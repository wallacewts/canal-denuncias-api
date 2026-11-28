import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ERROR_MESSAGES, type ApiError, type ApiValidationIssue } from './api-error.js';

interface RequestLike {
  id?: unknown;
  method?: string;
  url?: string;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): unknown;
}

interface Resolved {
  status: number;
  message: ApiError['message'];
}

/** Erro levantado pelo body parser do Express (`entity.parse.failed`, `entity.too.large`...). */
interface BodyParserError {
  type: string;
  status?: number;
}

function isBodyParserError(e: unknown): e is BodyParserError {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as BodyParserError).type === 'string' &&
    (e as BodyParserError).type.startsWith('entity.')
  );
}

/** Erro do http-errors (body parser, Express): status numérico e flag `expose` ou `type`. */
function isHttpErrorLike(e: unknown): e is { status?: number; statusCode?: number; type?: string } {
  if (typeof e !== 'object' || e === null) return false;
  const candidate = e as { status?: unknown; statusCode?: unknown };
  const hasStatus = typeof candidate.status === 'number' || typeof candidate.statusCode === 'number';
  return hasStatus && ('expose' in e || 'type' in e);
}

/**
 * Erro de transporte da requisição: corpo malformado, grande demais, charset ou encoding inválido, parâmetro de caminho
 * mal codificado. O Express gera e o Nest converte em `HttpException` com a mensagem original (que pode conter um
 * trecho do corpo ou do caminho) e o erro original em `cause`. Os dois formatos são tratados aqui.
 */
function transportErrorStatus(e: unknown): { status: number; uri: boolean } | undefined {
  if (isBodyParserError(e)) return { status: e.status ?? 400, uri: false };
  if (!(e instanceof HttpException)) return undefined;
  const cause = e.cause;
  if (cause instanceof URIError) return { status: e.getStatus(), uri: true };
  if (cause instanceof SyntaxError || isBodyParserError(cause) || isHttpErrorLike(cause)) {
    return { status: e.getStatus(), uri: false };
  }
  return undefined;
}

function isValidationIssues(value: unknown): value is ApiValidationIssue[] {
  return (
    Array.isArray(value) &&
    value.every((i) => typeof i === 'object' && i !== null && 'path' in i && 'code' in i && 'message' in i)
  );
}

/**
 * Filtro global de erros (TRV-01). Garante o formato único `{ statusCode, error, message, requestId }` e que nenhum
 * dado da requisição (corpo, parâmetros de query do banco, trecho de JSON malformado) chegue à resposta ou ao log.
 * O objeto de erro bruto nunca é logado: `QueryFailedError` carrega os parâmetros da query e o erro do body parser
 * carrega o corpo enviado.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<RequestLike>();
    const res = http.getResponse<ResponseLike>();

    const requestId = typeof req.id === 'string' && req.id.length > 0 ? req.id : randomUUID();
    req.id ??= requestId;

    const { status, message } = this.resolve(exception, req, requestId);
    const body: ApiError = { statusCode: status, error: STATUS_CODES[status] ?? 'Error', message, requestId };
    res.status(status).json(body);
  }

  private resolve(exception: unknown, req: RequestLike, requestId: string): Resolved {
    const logContext = { req: { id: requestId, method: req.method, path: req.url?.split('?')[0] } };

    const transport = transportErrorStatus(exception);
    if (transport && transport.status < 500) {
      const { status } = transport;
      this.logger.warn({ ...logContext, transportErrorStatus: status }, 'Requisição recusada antes da rota');
      const message = transport.uri
        ? ERROR_MESSAGES.invalidRequest
        : status === 413
          ? ERROR_MESSAGES.bodyTooLarge
          : status === 415
            ? ERROR_MESSAGES.unsupportedMediaType
            : ERROR_MESSAGES.invalidBody;
      return { status, message };
    }

    if (exception instanceof QueryFailedError) {
      const code = (exception.driverError as { code?: string } | undefined)?.code;
      if (code === '23505') return { status: 409, message: ERROR_MESSAGES.conflict };
      if (code === '23503') return { status: 409, message: ERROR_MESSAGES.relatedConflict };
      this.logger.error({ ...logContext, dbErrorCode: code ?? 'unknown' }, 'Erro de banco não tratado');
      return { status: 500, message: ERROR_MESSAGES.internal };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        this.logger.error({ ...logContext, err: { type: exception.name, stack: exception.stack } }, 'Erro 5xx');
        return { status, message: status === 503 ? ERROR_MESSAGES.unavailable : ERROR_MESSAGES.internal };
      }
      const response = exception.getResponse();
      const raw =
        typeof response === 'object' && response !== null ? (response as { message?: unknown }).message : response;
      if (isValidationIssues(raw)) return { status, message: raw };
      if (status === 404 && (typeof raw !== 'string' || /^Cannot [A-Z]+ /.test(raw))) {
        return { status, message: ERROR_MESSAGES.notFound };
      }
      return { status, message: typeof raw === 'string' ? raw : exception.message };
    }

    // Erro inesperado: a stack vai só para o log (TRV-01), nunca para a resposta.
    const err =
      exception instanceof Error ? { type: exception.name, stack: exception.stack } : { type: typeof exception };
    this.logger.error({ ...logContext, err }, 'Erro inesperado');
    return { status: 500, message: ERROR_MESSAGES.internal };
  }
}
