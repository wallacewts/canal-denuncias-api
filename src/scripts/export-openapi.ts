import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/**
 * Exporta o contrato da API em dois documentos (TRV-11, FR-038): `public.json` (só `/api/public/v1/*`) e
 * `admin.json` (só `/api/admin/v1/*`). O `npm run api:sync` do front gera um cliente para cada um, e assim o bundle
 * do portal nunca recebe tipos nem operações do backoffice. Roda sem banco, Vault ou rede: o app sobe em modo
 * `preview`, em que providers e controllers não são instanciados.
 */

const AREAS = { public: '/api/public/v1/', admin: '/api/admin/v1/' } as const;
type Area = keyof typeof AREAS;

/** Schemas que os dois clientes sempre recebem, mesmo sem referência explícita. */
const BASE_SCHEMAS: Record<string, object> = {
  ApiError: {
    type: 'object',
    description: 'Corpo de toda resposta de erro. Nunca contém valores recebidos na requisição.',
    additionalProperties: false,
    required: ['statusCode', 'error', 'message', 'requestId'],
    properties: {
      statusCode: { type: 'integer', minimum: 400, maximum: 599 },
      error: { type: 'string' },
      message: {
        oneOf: [
          { type: 'string' },
          {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'code', 'message'],
              properties: { path: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' } },
            },
          },
        ],
      },
      code: {
        type: 'string',
        pattern: '^[A-Z][A-Z0-9_]{1,63}$',
        description: 'Código estável de regra de negócio (D56), só em erros de domínio.',
      },
      details: {
        type: 'object',
        description: 'Detalhes do erro de domínio (D56): só inteiros não negativos e códigos em maiúsculas.',
        additionalProperties: {
          oneOf: [
            { type: 'integer', minimum: 0 },
            { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,63}$' },
          ],
        },
      },
      requestId: { type: 'string', format: 'uuid' },
    },
  },
  Page: {
    type: 'object',
    description: 'Resposta paginada por cursor. Entrada: ?limit=1..100 (padrão 20)&after=<nextCursor>.',
    additionalProperties: false,
    required: ['items', 'nextCursor'],
    properties: {
      items: { type: 'array', maxItems: 100, items: {} },
      nextCursor: { type: ['string', 'null'], pattern: '^[A-Za-z0-9_-]+$' },
    },
  },
};

async function packageVersion(): Promise<string> {
  // Mesmo caminho relativo a partir de src/scripts e de dist/scripts.
  const raw = await readFile(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

/** Documento completo da API, gerado sem instanciar providers. */
export async function generateFullDocument(rootModule: Type<unknown>): Promise<OpenAPIObject> {
  const app = await NestFactory.create(rootModule, { preview: true, logger: false });
  try {
    app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });
    const config = new DocumentBuilder()
      .setTitle('Canal de Denúncias API')
      .setVersion(await packageVersion())
      .build();
    return SwaggerModule.createDocument(app, config);
  } finally {
    await app.close();
  }
}

/** Separa o documento completo em um por área. O que está fora das duas áreas (health, docs) fica de fora. */
export function splitByArea(full: OpenAPIObject): Record<Area, OpenAPIObject> {
  const result = {} as Record<Area, OpenAPIObject>;
  for (const [area, prefix] of Object.entries(AREAS) as Array<[Area, string]>) {
    const paths = Object.fromEntries(Object.entries(full.paths).filter(([path]) => path.startsWith(prefix)));
    result[area] = {
      ...full,
      info: { ...full.info, title: `${full.info.title} (${area})` },
      tags: [{ name: area }],
      paths,
      components: { ...full.components, schemas: { ...full.components?.schemas } },
    };
  }
  return result;
}

function collectRefs(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, into);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string' && child.startsWith('#/components/schemas/')) {
        into.add(child.slice('#/components/schemas/'.length));
      } else {
        collectRefs(child, into);
      }
    }
  }
}

/** Mantém só os schemas alcançáveis a partir das operações (inclusive indiretamente) e os schemas base. */
export function pruneComponents(document: OpenAPIObject, keep: readonly string[]): OpenAPIObject {
  const all = (document.components?.schemas ?? {}) as Record<string, unknown>;
  const reachable = new Set<string>(keep.filter((name) => name in all));
  collectRefs(document.paths, reachable);

  const queue = [...reachable];
  while (queue.length > 0) {
    const found = new Set<string>();
    collectRefs(all[queue.pop()!], found);
    for (const name of found) {
      if (!reachable.has(name) && name in all) {
        reachable.add(name);
        queue.push(name);
      }
    }
  }

  const schemas = Object.fromEntries(Object.entries(all).filter(([name]) => reachable.has(name)));
  return { ...document, components: { ...document.components, schemas } } as OpenAPIObject;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** JSON com chaves ordenadas e indentação fixa, para o diff do contrato ser limpo. */
export function serializeDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(sortKeys(document), null, 2)}\n`;
}

export async function generateOpenApiDocuments(rootModule: Type<unknown>): Promise<Record<Area, OpenAPIObject>> {
  const full = await generateFullDocument(rootModule);
  full.components = { ...full.components, schemas: { ...full.components?.schemas, ...BASE_SCHEMAS } } as never;
  const split = splitByArea(full);
  const keep = Object.keys(BASE_SCHEMAS);
  return { public: pruneComponents(split.public, keep), admin: pruneComponents(split.admin, keep) };
}

export async function writeOpenApiDocuments(outDir: string, rootModule: Type<unknown>): Promise<void> {
  const documents = await generateOpenApiDocuments(rootModule);
  await mkdir(outDir, { recursive: true });
  for (const [area, document] of Object.entries(documents)) {
    await writeFile(join(outDir, `${area}.json`), serializeDocument(document), 'utf8');
  }
}

/**
 * Valores fictícios só para o `ConfigModule` aceitar o import do AppModule. Em modo preview nada se conecta a
 * esses endereços. Variáveis já definidas no ambiente têm precedência.
 */
const PREVIEW_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://openapi:openapi@127.0.0.1:1/openapi',
  REDIS_URL: 'redis://127.0.0.1:1',
  VAULT_ADDR: 'http://127.0.0.1:1',
  VAULT_TOKEN: 'openapi-export',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'openapi',
  S3_ACCESS_KEY: 'openapi',
  S3_SECRET_KEY: 'openapi',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1',
  CLAMAV_HOST: '127.0.0.1',
  CLAMAV_PORT: '1',
  SESSION_SECRET: 'openapi-export-session-secret-32-bytes',
  REPORTER_TOKEN_SECRET: 'openapi-export-reporter-secret-32-bytes',
};

async function main(): Promise<void> {
  for (const [name, value] of Object.entries(PREVIEW_ENV)) process.env[name] ??= value;
  const { AppModule } = await import('../app.module.js');
  const outDir = join(process.cwd(), 'openapi');
  await writeOpenApiDocuments(outDir, AppModule);
  console.log(`Contrato exportado em ${outDir}/public.json e ${outDir}/admin.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
