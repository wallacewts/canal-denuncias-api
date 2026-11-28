import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Role } from '../../common/enums/role.enum.js';
import { ABILITY_CATALOG, ABILITY_CODE_PATTERN, abilitiesFor, hasAbility, type Ability } from './abilities.js';

const { ADMIN, COMPLIANCE_MANAGER: MANAGER, ANALYST, DPO, AUDITOR } = Role;

/** Esperado copiado da matriz do ACL-01 (`docs/tarefas/05-access-control.md`), research R1. */
const EXPECTED: Record<Ability, Role[]> = {
  'users.manage': [ADMIN],
  'categories.manage': [ADMIN],
  'settings.sla': [ADMIN],
  'retention.manage': [DPO],
  'reports.list': [MANAGER, ANALYST, DPO],
  'reports.read': [MANAGER, ANALYST, DPO],
  'reports.triage': [MANAGER],
  'reports.treat': [MANAGER, ANALYST],
  'identity.request': [MANAGER, ANALYST],
  'identity.approve': [DPO],
  'audit.read': [AUDITOR],
  'dashboard.read': [MANAGER, DPO, AUDITOR],
};

/** Rótulo de cada linha da matriz → códigos do catálogo (uma linha pode virar mais de um código). */
const MATRIX_ROWS: Record<string, Ability[]> = {
  'Gerenciar usuários e categorias': ['users.manage', 'categories.manage'],
  'Alterar SLA': ['settings.sla'],
  'Alterar retenção e legal hold': ['retention.manage'],
  'Listar todas as denúncias': ['reports.list'],
  'Listar denúncias atribuídas a si': ['reports.list'],
  'Ver conteúdo da denúncia (somente leitura)': ['reports.read'],
  'Triar, atribuir, priorizar, bloquear por conflito': ['reports.triage'],
  'Mudar status, mensagens e notas': ['reports.treat'],
  'Pedir revelação de identidade': ['identity.request'],
  'Aprovar ou rejeitar revelação': ['identity.approve'],
  'Ver trilha de auditoria': ['audit.read'],
  'Ver indicadores': ['dashboard.read'],
};

const staff = (...roles: Role[]) => ({ id: '01900000-0000-7000-8000-000000000001', roles });

describe('Catálogo de habilidades (D55)', () => {
  it('tem exatamente os 12 códigos da matriz, com os perfis esperados', () => {
    expect(Object.keys(ABILITY_CATALOG).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [code, roles] of Object.entries(EXPECTED)) {
      expect([...ABILITY_CATALOG[code as Ability].roles].sort(), code).toEqual([...roles].sort());
    }
  });

  it.each(Object.values(Role))('perfil %s recebe só os códigos que a matriz concede', (role) => {
    const expected = Object.entries(EXPECTED)
      .filter(([, roles]) => roles.includes(role))
      .map(([code]) => code)
      .sort();
    expect(abilitiesFor([role])).toEqual(expected);
  });

  it('combinação de perfis é a união, ordenada e sem repetição', () => {
    const result = abilitiesFor([ANALYST, MANAGER, ANALYST]);
    expect(result).toEqual([...new Set([...abilitiesFor([ANALYST]), ...abilitiesFor([MANAGER])])].sort());
    expect(new Set(result).size).toBe(result.length);
  });

  it('sem perfil, nenhuma habilidade', () => {
    expect(abilitiesFor([])).toEqual([]);
  });

  it('todo código casa com o formato validado pelo front', () => {
    for (const code of Object.keys(ABILITY_CATALOG)) expect(code).toMatch(ABILITY_CODE_PATTERN);
    expect(ABILITY_CODE_PATTERN.source).toBe('^[a-z][a-z-]*\\.[a-z][a-z-]*$');
  });

  it('hasAbility segue o catálogo; sem usuário, falso', () => {
    expect(hasAbility(staff(ADMIN), 'users.manage')).toBe(true);
    expect(hasAbility(staff(AUDITOR), 'users.manage')).toBe(false);
    expect(hasAbility(staff(AUDITOR), 'audit.read')).toBe(true);
    expect(hasAbility(staff(ADMIN, ANALYST), 'reports.treat')).toBe(true);
    expect(hasAbility(null, 'audit.read')).toBe(false);
    expect(hasAbility(staff(), 'audit.read')).toBe(false);
  });

  it('marca o escopo: só as globais dispensam o registro', () => {
    const global = Object.entries(ABILITY_CATALOG)
      .filter(([, entry]) => entry.scope === 'global')
      .map(([code]) => code)
      .sort();
    expect(global).toEqual(['audit.read', 'categories.manage', 'dashboard.read', 'settings.sla', 'users.manage']);
  });
});

describe('Catálogo × matriz do documento (docs/tarefas/05-access-control.md)', () => {
  const doc = readFileSync(join(import.meta.dirname, '../../../docs/tarefas/05-access-control.md'), 'utf8');
  const section = doc.slice(doc.indexOf('### ACL-01'), doc.indexOf('### ACL-02'));
  const lines = section.split('\n').filter((l) => l.startsWith('|'));
  const header = lines[0].split('|').map((c) => c.trim());
  const roleColumns = header.slice(2, -1) as Role[];
  const rows = lines.slice(2).map((l) => l.split('|').map((c) => c.trim()));

  it('a tabela tem as colunas dos cinco perfis', () => {
    expect(roleColumns).toEqual([ADMIN, MANAGER, ANALYST, DPO, AUDITOR]);
  });

  it('toda linha da matriz está mapeada e nenhuma mapeada sumiu', () => {
    expect(rows.map((r) => r[1]).sort()).toEqual(Object.keys(MATRIX_ROWS).sort());
  });

  it('os perfis marcados em cada linha batem com o catálogo', () => {
    const fromDoc = new Map<Ability, Set<Role>>();
    for (const row of rows) {
      const marked = roleColumns.filter((_, i) => row[i + 2].startsWith('✅'));
      for (const code of MATRIX_ROWS[row[1]]) {
        const set = fromDoc.get(code) ?? new Set<Role>();
        marked.forEach((role) => set.add(role));
        fromDoc.set(code, set);
      }
    }
    for (const [code, roles] of fromDoc) {
      expect([...roles].sort(), code).toEqual([...ABILITY_CATALOG[code].roles].sort());
    }
  });
});
