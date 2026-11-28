import { ActorType } from '../../common/enums/actor-type.enum.js';
import { AuditResult } from '../../common/enums/audit-result.enum.js';
import { computeAuditHash, GENESIS_HASH } from './audit-hash.js';
import { ChainWalker, type ChainRow } from './audit-verifier.service.js';

function buildChain(n: number): ChainRow[] {
  const rows: ChainRow[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const base = {
      occurredAt: new Date(Date.UTC(2026, 10, 28, 0, 0, i)),
      actorType: ActorType.SYSTEM,
      actorUserId: null,
      action: 'REPORT_VIEWED',
      resourceType: 'report',
      resourceId: `r${i}`,
      result: AuditResult.SUCCESS,
      ip: null,
      userAgent: null,
      metadata: null,
    };
    const hash = computeAuditHash(prev, base);
    rows.push({ id: String(i), ...base, prevHash: prev, hash });
    prev = hash;
  }
  return rows;
}

function walk(rows: ChainRow[], start = GENESIS_HASH) {
  const walker = new ChainWalker(start);
  for (const row of rows) if (!walker.step(row)) break;
  return walker.result();
}

describe('ChainWalker (verificação da cadeia, AUDIT-07)', () => {
  it('cadeia íntegra: ok, todos verificados', () => {
    expect(walk(buildChain(5))).toEqual({ ok: true, checked: 5, firstBrokenId: null });
  });

  it('trilha vazia: íntegra, zero verificados', () => {
    expect(walk([])).toEqual({ ok: true, checked: 0, firstBrokenId: null });
  });

  it('registro com conteúdo alterado: quebra no próprio registro', () => {
    const rows = buildChain(5);
    rows[2] = { ...rows[2]!, resourceId: 'XQZ' };
    expect(walk(rows)).toEqual({ ok: false, checked: 2, firstBrokenId: '3' });
  });

  it('registro removido do meio: quebra no seguinte, cujo encadeamento não fecha', () => {
    const rows = buildChain(5);
    rows.splice(1, 1);
    expect(walk(rows)).toEqual({ ok: false, checked: 1, firstBrokenId: '3' });
  });

  it('primeiro registro que não parte da gênese: quebra nele', () => {
    const rows = buildChain(3).slice(1);
    expect(walk(rows)).toEqual({ ok: false, checked: 0, firstBrokenId: '2' });
  });

  it('hash trocado por outro válido de formato: quebra', () => {
    const rows = buildChain(3);
    rows[1] = { ...rows[1]!, hash: Buffer.alloc(32, 7) };
    expect(walk(rows).firstBrokenId).toBe('2');
  });
});
