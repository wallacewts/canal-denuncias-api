import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(import.meta.dirname, '../../src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [full] : [];
  });
}

/**
 * Nada de `src/` importa código de `test/`. Em especial a identidade só de teste (`fake-identity.ts`): se ela chegasse
 * ao build, um cabeçalho bastaria para entrar na área administrativa (D47).
 */
describe('Convenção: src não importa código de teste', () => {
  it('nenhum import de src/ aponta para test/ nem para fake-identity', () => {
    const violations = tsFiles(SRC).flatMap((file) => {
      const content = readFileSync(file, 'utf8');
      const imports = [...content.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
        (m) => m[1] ?? m[2] ?? '',
      );
      return imports
        .filter((spec) => /(^|\/)test\//.test(spec) || spec.includes('fake-identity'))
        .map((spec) => `${relative(SRC, file)} → ${spec}`);
    });
    expect(violations).toEqual([]);
  });
});
