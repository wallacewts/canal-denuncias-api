import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { generateOpenApiDocuments, writeOpenApiDocuments } from '../../src/scripts/export-openapi.js';
import { PublicFixtureModule } from '../support/fixtures/public-fixture.module.js';
import { ValidationFixtureModule } from '../support/fixtures/validation-fixture.module.js';

/** Raiz só com fixtures: uma rota pública, administrativas e uma rota sem área (que não entra em nenhum documento). */
@Module({ imports: [PublicFixtureModule, ValidationFixtureModule] })
class FixtureRootModule {}

describe('npm run openapi:export (e2e)', () => {
  it('gera public e admin separados, sem banco, com os schemas base', async () => {
    const { public: pub, admin } = await generateOpenApiDocuments(FixtureRootModule);

    expect(Object.keys(pub.paths).length).toBeGreaterThan(0);
    expect(Object.keys(pub.paths).every((p) => p.startsWith('/api/public/v1/'))).toBe(true);
    expect(Object.keys(admin.paths).every((p) => p.startsWith('/api/admin/v1/'))).toBe(true);
    expect(pub.paths).toHaveProperty('/api/public/v1/fixtures/cookie');
    expect(admin.paths).toHaveProperty('/api/admin/v1/fixtures/sensitive');

    for (const document of [pub, admin]) {
      const paths = Object.keys(document.paths);
      expect(paths).not.toContain('/health');
      expect(paths).not.toContain('/ready');
      expect(paths.some((p) => p.includes('fixtures/validation'))).toBe(false);
      expect(document.components?.schemas).toHaveProperty('ApiError');
      expect(document.components?.schemas).toHaveProperty('Page');
    }

    expect(JSON.stringify(pub)).not.toContain('AdminFixtureController');
    expect(JSON.stringify(admin)).not.toContain('PublicFixtureController');
    expect(pub.tags?.map((t) => t.name)).toEqual(['public']);
    expect(admin.tags?.map((t) => t.name)).toEqual(['admin']);
  });

  it('grava public.json e admin.json idênticos em duas execuções', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openapi-'));
    try {
      await writeOpenApiDocuments(dir, FixtureRootModule);
      const first = [await readFile(join(dir, 'public.json'), 'utf8'), await readFile(join(dir, 'admin.json'), 'utf8')];
      await writeOpenApiDocuments(dir, FixtureRootModule);
      const second = [
        await readFile(join(dir, 'public.json'), 'utf8'),
        await readFile(join(dir, 'admin.json'), 'utf8'),
      ];
      expect(second).toEqual(first);
      expect(JSON.parse(first[0]!).info.version).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
