import type { OpenAPIObject } from '@nestjs/swagger';
import { pruneComponents, serializeDocument, splitByArea } from './export-openapi.js';

function doc(paths: OpenAPIObject['paths'], schemas: Record<string, object>): OpenAPIObject {
  return { openapi: '3.1.0', info: { title: 't', version: '1' }, paths, components: { schemas } };
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

describe('exportação do OpenAPI', () => {
  const full = doc(
    {
      '/api/public/v1/tracking': {
        post: {
          responses: { 200: { description: 'ok', content: { 'application/json': { schema: ref('Tracking') } } } },
        },
      },
      '/api/admin/v1/reports': {
        get: {
          responses: { 200: { description: 'ok', content: { 'application/json': { schema: ref('ReportList') } } } },
        },
      },
      '/health': { get: { responses: { 200: { description: 'ok' } } } },
    },
    {
      Tracking: { type: 'object', properties: { status: ref('Status') } },
      Status: { type: 'string' },
      ReportList: { type: 'object', properties: { items: { type: 'array', items: ref('ReportItem') } } },
      ReportItem: { type: 'object' },
      Orphan: { type: 'object' },
    },
  );

  it('separa os caminhos por área e deixa health de fora', () => {
    const { public: pub, admin } = splitByArea(full);
    expect(Object.keys(pub.paths)).toEqual(['/api/public/v1/tracking']);
    expect(Object.keys(admin.paths)).toEqual(['/api/admin/v1/reports']);
  });

  it('cada documento leva só os schemas que alcança, inclusive os referenciados indiretamente', () => {
    const { public: pub, admin } = splitByArea(full);
    expect(Object.keys(pruneComponents(pub, []).components!.schemas!).sort()).toEqual(['Status', 'Tracking']);
    expect(Object.keys(pruneComponents(admin, []).components!.schemas!).sort()).toEqual(['ReportItem', 'ReportList']);
  });

  it('mantém os schemas base mesmo sem referência', () => {
    const { public: pub } = splitByArea(full);
    expect(Object.keys(pruneComponents(pub, ['Orphan']).components!.schemas!).sort()).toEqual([
      'Orphan',
      'Status',
      'Tracking',
    ]);
  });

  it('serializa com chaves em ordem estável e quebra de linha no fim', () => {
    const a = serializeDocument({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } } as never);
    const b = serializeDocument({ a: { c: [{ y: 2, z: 1 }], d: 2 }, b: 1 } as never);
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
    expect(a.indexOf('"a"')).toBeLessThan(a.indexOf('"b"'));
  });
});
