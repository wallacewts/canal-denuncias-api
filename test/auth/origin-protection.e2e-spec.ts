import request from 'supertest';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import type { DataSource } from 'typeorm';
import { createAuthApp } from './support.js';

const SIGN_IN = '/api/admin/v1/auth/sign-in';
const BODY = { email: 'ninguem@empresa.test', password: 'qualquer-coisa' };

/** US5 (T034, R10): escrita só da mesma origem ou de origem confiável; CORS com credenciais só para o backoffice. */
describe('Proteção por origem e CORS (e2e)', () => {
  let t: TestApp & { clock: TestClock; ds: DataSource };
  const post = () => request(t.app.getHttpServer()).post(SIGN_IN).send(BODY);

  beforeAll(async () => {
    t = await createAuthApp();
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('Origin de fora: 403, antes da rota (nenhuma tentativa de login registrada)', async () => {
    const before = await t.ds.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'AUTH_LOGIN_FAILED'`);
    const res = await post().set('Origin', 'https://evil.example').expect(403);
    expect(res.text).not.toContain('evil');
    const after = await t.ds.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'AUTH_LOGIN_FAILED'`);
    expect(after).toEqual(before);
  });

  it('Sec-Fetch-Site: cross-site: 403', async () => {
    await post().set('Sec-Fetch-Site', 'cross-site').expect(403);
  });

  it('mesma origem, origem confiável e cliente sem Origin chegam à rota (401 da credencial)', async () => {
    await post().set('Sec-Fetch-Site', 'same-origin').expect(401);
    await post().set('Origin', 'http://localhost:4300').expect(401);
    await post().expect(401);
  });

  it('GET de outra origem não é bloqueado pela proteção (só escrita)', async () => {
    await request(t.app.getHttpServer()).get('/health').set('Origin', 'https://evil.example').expect(200);
  });

  it('CORS: credenciais só para a origem do backoffice', async () => {
    const ok = await request(t.app.getHttpServer())
      .options(SIGN_IN)
      .set('Origin', 'http://localhost:4300')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:4300');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(t.app.getHttpServer())
      .options(SIGN_IN)
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});
