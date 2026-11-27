import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildLoggerParams } from './logger.config.js';

type Serializers = {
  req: (req: Partial<IncomingMessage> & { id?: string }) => Record<string, unknown>;
  res: (res: Partial<ServerResponse>) => Record<string, unknown>;
};

describe('buildLoggerParams (anonimato nos logs)', () => {
  const params = buildLoggerParams({ NODE_ENV: 'production', LOG_LEVEL: 'info' });
  const pinoHttp = params.pinoHttp as { serializers: Serializers; transport?: unknown };
  const { serializers } = pinoHttp;

  const fakeReq = {
    id: 'req-1',
    method: 'POST',
    url: '/api/public/v1/tracking?protocol=DV-8F3K2-Q7M4N',
    headers: { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'Mozilla/5.0', cookie: 'a=b' },
    socket: { remoteAddress: '203.0.113.9', remotePort: 51234 },
  } as unknown as IncomingMessage & { id: string };

  it('loga só id, método e caminho da requisição', () => {
    expect(serializers.req(fakeReq)).toEqual({ id: 'req-1', method: 'POST', path: '/api/public/v1/tracking' });
  });

  it('nunca inclui IP, cabeçalhos ou query string', () => {
    const logged = JSON.stringify(serializers.req(fakeReq));
    expect(logged).not.toContain('203.0.113.9');
    expect(logged).not.toContain('Mozilla');
    expect(logged).not.toContain('DV-8F3K2');
    expect(logged).not.toContain('cookie');
  });

  it('loga só o status da resposta', () => {
    expect(serializers.res({ statusCode: 201, getHeaders: () => ({ 'set-cookie': 'x' }) } as never)).toEqual({
      statusCode: 201,
    });
  });

  it('não usa pino-pretty fora de desenvolvimento', () => {
    expect(pinoHttp.transport).toBeUndefined();
  });
});
