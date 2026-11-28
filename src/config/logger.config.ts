import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { Options } from 'pino-http';
import type { Env } from './env.schema.js';

/**
 * Logs JSON no stdout. Por exigência de anonimato, a requisição é logada SEM IP, porta,
 * cabeçalhos, query string e corpo: só id, método, caminho e status.
 * Nenhuma rota pode levar protocolo, chave ou dado pessoal no caminho da URL.
 *
 * `destination` só é usado nos testes (captura em memória). Sem ele, o log vai para o stdout.
 */
export function buildLoggerParams(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>, destination?: DestinationStream): Params {
  const options: Options = {
    level: env.LOG_LEVEL,
    genReqId: () => randomUUID(),
    serializers: {
      req: (req: IncomingMessage & { id?: string }) => ({
        id: req.id,
        method: req.method,
        path: req.url?.split('?')[0],
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
    redact: {
      paths: ['*.password', '*.accessKey', '*.token', '*.authorization', '*.cookie'],
      censor: '[REDACTED]',
    },
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/ready',
    },
    transport:
      env.NODE_ENV === 'development' && !destination
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
  };

  return { pinoHttp: destination ? [options, destination] : options };
}
