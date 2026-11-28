import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Role } from '../../src/common/enums/role.enum.js';
import { ABILITY_CATALOG, ABILITY_CODE_PATTERN } from '../../src/modules/access-control/abilities.js';

/**
 * Contrato do `GET /me` (feature 005, T034): o schema publicado em `openapi/admin.json` bate com o `CurrentUser` do
 * front (`canal-denuncias-web/specs/004-backoffice-sign-in/contracts/auth-api.md`, só leitura). O front recusa
 * resposta com chave a mais ou a menos, então as chaves precisam ser exatamente as mesmas. Sem o repositório do front
 * ao lado (CI), a comparação com o documento do front é pulada; a do schema publicado com o catálogo continua.
 */
const ROOT = join(import.meta.dirname, '../..');
const FRONT_CONTRACT = join(ROOT, '../canal-denuncias-web/specs/004-backoffice-sign-in/contracts/auth-api.md');

interface JsonSchema {
  type?: string | string[];
  format?: string;
  enum?: string[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  anyOf?: JsonSchema[];
}

function meSchema(): JsonSchema {
  const doc = JSON.parse(readFileSync(join(ROOT, 'openapi/admin.json'), 'utf8')) as {
    paths: Record<string, { get?: { responses: Record<string, { content?: Record<string, { schema: JsonSchema }> }> } }>;
  };
  const schema = doc.paths['/api/admin/v1/me']?.get?.responses['200']?.content?.['application/json']?.schema;
  if (!schema) throw new Error('GET /me sem schema de resposta 200 no openapi/admin.json');
  return schema;
}

/** Tipo de cada campo do `CurrentUser` (com o `SessionExpiry` embutido), como escrito no contrato do front. */
function frontFields(markdown: string): Map<string, string> {
  const block = (name: string) => {
    const start = markdown.indexOf(`${name} `);
    const open = markdown.indexOf('{', start);
    const close = markdown.indexOf('}', open);
    return markdown.slice(open + 1, close);
  };
  const fields = new Map<string, string>();
  for (const part of `${block('CurrentUser')},${block('SessionExpiry')}`.split(',')) {
    const [key, ...rest] = part.split(':');
    if (!key.trim()) continue;
    fields.set(key.trim(), rest.join(':').replace(/\(.*\)/, '').trim());
  }
  return fields;
}

function frontRoles(markdown: string): string[] {
  const line = markdown.split('\n').find((l) => /^Role\s+=/.test(l)) ?? '';
  return [...line.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}

function typeOf(schema: JsonSchema): string {
  if (schema.anyOf) return schema.anyOf.map(typeOf).sort().join(' | ');
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return types
    // Datas ISO são texto para o front; o uuid fica marcado porque o contrato do front o distingue.
    .map((t) => (t === 'array' ? `${typeOf(schema.items!)}[]` : t === 'string' && schema.format === 'uuid' ? 'uuid' : t))
    .sort()
    .join(' | ');
}

describe('Contrato do GET /me (openapi/admin.json)', () => {
  it('publica um objeto fechado, com as habilidades do catálogo e os perfis do sistema', () => {
    const schema = meSchema();
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect([...(schema.required ?? [])].sort()).toEqual(Object.keys(schema.properties ?? {}).sort());
    expect(schema.properties!.abilities.items!.enum!.sort()).toEqual(Object.keys(ABILITY_CATALOG).sort());
    for (const code of schema.properties!.abilities.items!.enum!) expect(code).toMatch(ABILITY_CODE_PATTERN);
    expect(schema.properties!.roles.items!.enum!.sort()).toEqual(Object.values(Role).sort());
  });

  describe.skipIf(!existsSync(FRONT_CONTRACT))('× CurrentUser do front (só leitura)', () => {
    const markdown = existsSync(FRONT_CONTRACT) ? readFileSync(FRONT_CONTRACT, 'utf8') : '';

    it('mesmas chaves, nenhuma a mais nem a menos', () => {
      expect(Object.keys(meSchema().properties!).sort()).toEqual([...frontFields(markdown).keys()].sort());
    });

    it('mesmos tipos', () => {
      const props = meSchema().properties!;
      const expected: Record<string, string> = {
        uuid: 'uuid',
        string: 'string',
        boolean: 'boolean',
        'string | null': 'null | string',
        'Role[]': 'string[]',
        'Ability[]': 'string[]',
      };
      for (const [key, frontType] of frontFields(markdown)) {
        expect([key, typeOf(props[key])]).toEqual([key, expected[frontType]]);
      }
    });

    it('mesmos perfis', () => {
      expect(meSchema().properties!.roles.items!.enum!.sort()).toEqual(frontRoles(markdown).sort());
    });
  });
});
