import { Controller, Get, type INestApplication } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { API_AREA_METADATA, PublicApi } from '../../src/common/http/route-decorators.js';
import { PublicFixtureModule } from '../support/fixtures/public-fixture.module.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Único parâmetro de caminho aceito em rota pública: o UUID aleatório do anexo (FR-023). */
const ALLOWED_PUBLIC_PARAMS = new Set(['attachmentId']);

/**
 * Percorre todos os controllers registrados e devolve as rotas públicas com parâmetro de caminho proibido.
 * Uma rota pública nova que tente levar protocolo, chave ou dado pessoal no caminho faz este teste falhar.
 */
function findPublicRouteViolations(app: INestApplication): string[] {
  const discovery = app.get(DiscoveryService);
  const scanner = new MetadataScanner();
  const violations: string[] = [];

  for (const wrapper of discovery.getControllers()) {
    const type = wrapper.metatype as (new (...args: never[]) => object) | undefined;
    if (!type || Reflect.getMetadata(API_AREA_METADATA, type) !== 'public') continue;

    const base = String(Reflect.getMetadata(PATH_METADATA, type) ?? '');
    const paths = [base];
    for (const method of scanner.getAllMethodNames(type.prototype)) {
      const handler = (type.prototype as Record<string, unknown>)[method] as object;
      const routePath = Reflect.getMetadata(PATH_METADATA, handler);
      if (routePath !== undefined) paths.push(`${base}/${String(routePath)}`);
    }
    for (const path of paths) {
      for (const [, param] of path.matchAll(/:(\w+)/g)) {
        if (!ALLOWED_PUBLIC_PARAMS.has(param!)) violations.push(`${type.name}: /${path} (:${param})`);
      }
    }
  }
  return violations;
}

describe('Convenções das rotas públicas e administrativas (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [PublicFixtureModule, DiscoveryModule] });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(() => t.logs.clear());

  it('nenhuma rota pública registrada tem parâmetro de caminho proibido', () => {
    expect(findPublicRouteViolations(t.app)).toEqual([]);
  });

  it('a verificação detecta uma rota pública com parâmetro proibido', async () => {
    @PublicApi('tracking')
    @Controller()
    class BadPublicController {
      @Get(':protocol')
      find() {
        return {};
      }
    }
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [BadPublicController],
    }).compile();
    const bad = moduleRef.createNestApplication();
    await bad.init();
    try {
      expect(findPublicRouteViolations(bad)).toEqual([expect.stringContaining(':protocol')]);
    } finally {
      await bad.close();
    }
  });

  it('rota pública nunca devolve Set-Cookie e proíbe cache', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/public/v1/fixtures/cookie').expect(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['pragma']).toBe('no-cache');
  });

  it('rota pública com o único parâmetro permitido funciona e proíbe cache', async () => {
    const id = '0190a6e2-7c1b-7d3e-9f00-1a2b3c4d5e6f';
    const res = await request(t.app.getHttpServer()).get(`/api/public/v1/fixtures/attachments/${id}`).expect(200);
    expect(res.body).toEqual({ attachmentId: id });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('rota administrativa também proíbe cache', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/admin/v1/fixtures/sensitive').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['pragma']).toBe('no-cache');
  });

  it('requisição pública com X-Forwarded-For não deixa o IP em nenhuma linha de log', async () => {
    await request(t.app.getHttpServer())
      .get('/api/public/v1/fixtures/cookie')
      .set('X-Forwarded-For', '198.51.100.23')
      .set('User-Agent', 'Agente-Do-Denunciante/2.0')
      .expect(200);
    const text = t.logs.text();
    expect(text).toContain('/api/public/v1/fixtures/cookie');
    expect(text).not.toContain('198.51.100.23');
    expect(text).not.toContain('Agente-Do-Denunciante');
  });
});
