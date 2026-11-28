import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contrato do login (feature 006, R12, regra C1): o `openapi/admin.json` atende o que o front lista em
 * `canal-denuncias-web/specs/004-backoffice-sign-in/contracts/auth-api.md` (só leitura): mesmas rotas, mesmas chaves
 * e tipos de sucesso, os status e códigos de erro do front presentes na rota. Status a mais da API só os da lista
 * explícita abaixo. Sem o repositório do front ao lado (CI), o teste é pulado.
 */
const ROOT = join(import.meta.dirname, '../..');
const FRONT = join(ROOT, '../canal-denuncias-web/specs/004-backoffice-sign-in/contracts/auth-api.md');
const PREFIX = '/api/admin/v1';

/** Status que a API pode ter a mais que o front (C1): validação, origem, troca/etapa e limite no desafio. */
const EXTRA_STATUS: Record<string, string[]> = {
  '*': ['400', '403'],
  'POST /auth/mfa/challenge': ['429'],
};

interface Schema {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  anyOf?: Schema[];
  minItems?: number;
  maxItems?: number;
}
type Operation = { responses: Record<string, { description?: string; content?: Record<string, { schema: Schema }> }> };

const openapi = JSON.parse(readFileSync(join(ROOT, 'openapi/admin.json'), 'utf8')) as {
  paths: Record<string, Record<string, Operation>>;
};

interface FrontRoute {
  method: string;
  path: string;
  success: string;
  errors: string;
}

function frontRoutes(md: string): FrontRoute[] {
  const section = md.slice(md.indexOf('## Rotas'), md.indexOf('Regras:', md.indexOf('## Rotas')));
  return section
    .split('\n')
    .filter((l) => /^\| `(GET|POST|PUT|DELETE|PATCH) /.test(l))
    .map((l) => {
      const cells = l.split(/(?<!\\)\|/).map((c) => c.trim());
      const [method, path] = cells[1].replace(/`/g, '').split(' ');
      return { method, path, success: cells[3], errors: cells[4] };
    });
}

/** Chaves de um tipo do front (`StepResponse`, `CurrentUser`, objeto literal, interseções com `&`). */
function frontKeys(md: string, expr: string): string[] {
  const block = (name: string) => {
    const start = md.search(new RegExp(`^${name}\\s+=`, 'm'));
    const rest = md.slice(start);
    return rest.slice(0, rest.search(/\n[A-Z][A-Za-z]+\s+=|\n```/));
  };
  const keysOfLiteral = (literal: string) =>
    literal
      .replace(/^[^{]*\{/, '')
      .replace(/\}[^}]*$/, '')
      .split(',')
      .map((p) => p.split(':')[0].trim())
      .filter((k) => /^[a-zA-Z]+$/.test(k));
  return expr
    .split('&')
    .map((part) => part.trim())
    .flatMap((part) => {
      if (part.startsWith('{')) return keysOfLiteral(part);
      const definition = block(part).replace(new RegExp(`^${part}\\s+=`), '');
      return frontKeys(md, definition.replace(/\s+/g, ' ').trim());
    });
}

describe.skipIf(!existsSync(FRONT))('Contrato do login × front (openapi/admin.json, C1)', () => {
  const md = existsSync(FRONT) ? readFileSync(FRONT, 'utf8') : '';
  const routes = existsSync(FRONT) ? frontRoutes(md) : [];

  it('o contrato do front lista as rotas do login', () => {
    expect(routes.length).toBeGreaterThanOrEqual(6);
  });

  it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))('%s', (_name, route) => {
    const operation = openapi.paths[`${PREFIX}${route.path}`]?.[route.method.toLowerCase()];
    expect(operation, 'rota existe no OpenAPI').toBeDefined();
    const statuses = Object.keys(operation.responses);

    // Sucesso: mesmo status e, havendo corpo, exatamente as mesmas chaves (o front recusa chave a mais ou a menos).
    const successStatus = route.success.match(/\b(2\d\d)\b/)![1];
    expect(statuses, `sucesso ${successStatus}`).toContain(successStatus);
    const typeExpr = route.success.match(/`([^`]+)`/)?.[1];
    if (typeExpr) {
      const schema = operation.responses[successStatus].content?.['application/json']?.schema;
      expect(schema, 'schema de sucesso documentado').toBeDefined();
      expect(schema!.additionalProperties).toBe(false);
      expect(Object.keys(schema!.properties ?? {}).sort()).toEqual([...new Set(frontKeys(md, typeExpr))].sort());
      if (typeExpr.includes('string[10]')) {
        expect(schema!.properties!.recoveryCodes).toMatchObject({ minItems: 10, maxItems: 10 });
      }
    }

    // Erros: todo status e código que o front trata existe na rota.
    const frontStatuses = [...new Set(route.errors.match(/\b4\d\d\b/g) ?? [])];
    for (const status of frontStatuses) expect(statuses, `erro ${status}`).toContain(status);
    const descriptions = Object.values(operation.responses)
      .map((r) => r.description ?? '')
      .join(' ');
    for (const code of route.errors.match(/'([A-Z][A-Z0-9_]{3,})'/g) ?? []) {
      expect(descriptions, `código ${code}`).toContain(code.replace(/'/g, ''));
    }

    // Status a mais da API: só os da lista explícita (C1).
    const allowed = new Set([...frontStatuses, successStatus, ...EXTRA_STATUS['*'], ...(EXTRA_STATUS[`${route.method} ${route.path}`] ?? [])]);
    const extra = statuses.filter((s) => !allowed.has(s));
    expect(extra, 'status sem previsão no front nem na lista C1').toEqual([]);
  });
});
