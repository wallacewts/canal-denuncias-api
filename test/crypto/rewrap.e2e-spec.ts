import { DataSource } from 'typeorm';
import { ActorType } from '../../src/common/enums/actor-type.enum.js';
import { AuditResult } from '../../src/common/enums/audit-result.enum.js';
import { KEY_SERVICE, type KeyService } from '../../src/infra/vault/key-service.js';
import { VaultAuth } from '../../src/infra/vault/vault-auth.js';
import { VaultClient } from '../../src/infra/vault/vault.client.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { DataKeyService } from '../../src/modules/crypto/data-key.service.js';
import { encryptionContext } from '../../src/modules/crypto/encryption-context.js';
import { RecordCipher } from '../../src/modules/crypto/record-cipher.service.js';
import { RewrapService } from '../../src/modules/crypto/rewrap.service.js';
import { ReportContentV1Schema } from '../../src/modules/reports/report-content.js';
import { createEncryptedReport, cryptoDeps, type CryptoDeps } from '../support/factories.js';
import { createTestApp, type TestApp } from '../support/test-app.js';
import { rotateKek } from '../support/vault-admin.js';
import { acquireKekRotationLock } from '../support/kek-lock.js';

interface AuditRow {
  action: string;
  actor_type: ActorType;
  actor_user_id: string | null;
  ip: string | null;
  resource_type: string;
  resource_id: string;
  result: AuditResult;
  metadata: Record<string, unknown>;
}

/** CRYPTO-06 / US7: a suíte sobe com o AppRole `maintenance` (o único com rewrap); o root só gira a chave. */
describe('Recifragem das chaves das denúncias (e2e)', () => {
  /** Serializa com as outras suítes que giram a report-kek (pendência F1). */
  let kekLock: { release(): Promise<void> };
  let t: TestApp;
  let ds: DataSource;
  let rewrap: RewrapService;
  let deps: CryptoDeps;

  beforeAll(async () => {
    kekLock = await acquireKekRotationLock();
    t = await createTestApp({ vault: 'maintenance' });
    ds = t.app.get(DataSource);
    rewrap = t.app.get(RewrapService);
    // A criação de denúncias usa a credencial da API (o perfil de manutenção não gera chaves).
    const apiKeys = new VaultClient({
      addr: process.env.VAULT_ADDR!,
      timeoutMs: 2000,
      auth: new VaultAuth({
        addr: process.env.VAULT_ADDR!,
        roleId: 'dev-api-role-id',
        secretId: 'dev-api-secret-id',
        timeoutMs: 2000,
      }),
    });
    deps = { ...cryptoDeps(t.app), dataKeys: new DataKeyService(apiKeys) };
  });

  afterAll(async () => {
    await kekLock?.release();
    await t.close();
  });

  async function seed(n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push((await createEncryptedReport(ds, deps, { v: 1, description: `XQZ ${i}` })).report.id);
    }
    return ids;
  }

  async function rows(ids: string[]): Promise<Array<{ id: string; content_enc: Buffer; wrapped: string }>> {
    return ds.query(
      `SELECT id, content_enc, convert_from(wrapped_dek, 'UTF8') AS wrapped FROM reports WHERE id = ANY($1) ORDER BY id`,
      [ids],
    );
  }

  async function audits(since: number): Promise<AuditRow[]> {
    return ds.query(
      `SELECT action, actor_type, actor_user_id, host(ip) AS ip, resource_type, resource_id, result, metadata
         FROM audit_logs WHERE id > $1 AND action LIKE 'KEYS_REWRAP%' ORDER BY id`,
      [since],
    );
  }

  async function lastAuditId(): Promise<number> {
    const [{ id }] = (await ds.query(`SELECT coalesce(max(id), 0)::int AS id FROM audit_logs`)) as Array<{
      id: number;
    }>;
    return id;
  }

  async function openAll(ids: string[]): Promise<void> {
    const apiKeys = deps.dataKeys;
    for (const r of await rows(ids)) {
      const content = await apiKeys.withReportKey(r.wrapped, (dek) =>
        t.app.get(RecordCipher).openJson(dek, encryptionContext('reports.content_enc', r.id), r.content_enc, {
          1: ReportContentV1Schema,
        }),
      );
      expect(content.description).toMatch(/^XQZ/);
    }
  }

  it('gira a chave, recifra tudo em lotes, não toca no conteúdo e audita por lote e por execução', async () => {
    const ids = await seed(5);
    const before = await rows(ids);
    const latest = await rotateKek('report-kek');
    const since = await lastAuditId();

    const result = await rewrap.run({ batchSize: 2 });
    expect(result).toMatchObject({ latestVersion: latest, rewrapped: 5, skipped: 0, failed: 0, completed: true });

    const after = await rows(ids);
    for (const [i, r] of after.entries()) {
      expect(r.wrapped.startsWith(`vault:v${latest}:`)).toBe(true);
      expect(r.content_enc.equals(before[i].content_enc)).toBe(true);
    }
    await openAll(ids);

    const log = await audits(since);
    const batches = log.filter((a) => a.action === 'KEYS_REWRAPPED');
    const runs = log.filter((a) => a.action === 'KEYS_REWRAP_RUN');
    expect(batches.length).toBeGreaterThanOrEqual(3);
    expect(runs).toHaveLength(1);
    expect(runs[0].result).toBe(AuditResult.SUCCESS);
    for (const a of log) {
      expect(a).toMatchObject({ actor_type: ActorType.SYSTEM, actor_user_id: null, ip: null });
      expect(a).toMatchObject({ resource_type: 'kek', resource_id: 'report-kek' });
      for (const v of Object.values(a.metadata)) expect(typeof v).toBe('number');
      for (const r of after) expect(JSON.stringify(a)).not.toContain(r.id);
    }
  });

  it('uma segunda execução não recifra nada', async () => {
    await seed(1);
    await rotateKek('report-kek');
    await rewrap.run({ batchSize: 50 });
    const second = await rewrap.run({ batchSize: 50 });
    expect(second).toMatchObject({ rewrapped: 0, failed: 0, completed: true });
  });

  it('execução interrompida depois do primeiro lote termina na seguinte (resumo FAILURE na interrompida)', async () => {
    const ids = await seed(4);
    const latest = await rotateKek('report-kek');
    const since = await lastAuditId();
    const controller = new AbortController();
    const first = await rewrap.run({
      batchSize: 2,
      signal: controller.signal,
      onBatchCommitted: () => controller.abort(),
    });
    expect(first.completed).toBe(false);
    expect(first.rewrapped).toBeLessThan(4);
    const second = await rewrap.run({ batchSize: 2 });
    expect(second.completed).toBe(true);
    for (const r of await rows(ids)) expect(r.wrapped.startsWith(`vault:v${latest}:`)).toBe(true);
    const runs = (await audits(since)).filter((a) => a.action === 'KEYS_REWRAP_RUN');
    expect(runs.map((r) => r.result)).toEqual([AuditResult.FAILURE, AuditResult.SUCCESS]);
  });

  it('linha alterada no meio da execução é contada como ignorada', async () => {
    const [id] = await seed(1);
    await rotateKek('report-kek');
    const result = await rewrap.run({
      batchSize: 50,
      beforeBatchCommit: async (batchIds: string[]) => {
        if (batchIds.includes(id)) {
          await ds.query(`UPDATE reports SET wrapped_dek = NULL WHERE id = $1`, [id]);
        }
      },
    });
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it('falha na gravação do lote desfaz os UPDATEs e o registro juntos', async () => {
    const ids = await seed(2);
    await rotateKek('report-kek');
    const before = await rows(ids);
    const since = await lastAuditId();
    const result = await rewrap
      .run({
        batchSize: 50,
        inBatchTransaction: () => {
          throw new Error('falha forçada no lote');
        },
      })
      .catch((e: unknown) => e);
    expect(result).toBeInstanceOf(Error);
    expect((await rows(ids)).map((r) => r.wrapped)).toEqual(before.map((r) => r.wrapped));
    const log = await audits(since);
    expect(log.filter((a) => a.action === 'KEYS_REWRAPPED')).toHaveLength(0);
    expect(log.filter((a) => a.action === 'KEYS_REWRAP_RUN').map((a) => a.result)).toEqual([AuditResult.FAILURE]);
    await rewrap.run({ batchSize: 50 });
  });

  it('Vault fora do ar no meio da execução: FAILURE, e a execução seguinte termina (G3)', async () => {
    const ids = await seed(4);
    const latest = await rotateKek('report-kek');
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).includes('/transit/rewrap/') && ++calls > 2) throw new TypeError('fetch failed');
      return original(...args);
    }) as typeof fetch;
    let first: unknown;
    try {
      first = await rewrap.run({ batchSize: 2 }).catch((e: unknown) => e);
    } finally {
      globalThis.fetch = original;
    }
    expect(first).toBeInstanceOf(Error);
    const second = await rewrap.run({ batchSize: 2 });
    expect(second.completed).toBe(true);
    for (const r of await rows(ids)) expect(r.wrapped.startsWith(`vault:v${latest}:`)).toBe(true);
  });

  it('com a credencial da API, a operação falha e o resumo registra FAILURE', async () => {
    await seed(1);
    await rotateKek('report-kek');
    const apiAuth = new VaultAuth({
      addr: process.env.VAULT_ADDR!,
      roleId: 'dev-api-role-id',
      secretId: 'dev-api-secret-id',
      timeoutMs: 2000,
    });
    const apiKeys: KeyService = new VaultClient({ addr: process.env.VAULT_ADDR!, timeoutMs: 2000, auth: apiAuth });
    const withApi = new RewrapService(apiKeys, ds, t.app.get(AuditService));
    const since = await lastAuditId();
    await expect(withApi.run({ batchSize: 50 })).rejects.toThrow();
    const runs = (await audits(since)).filter((a) => a.action === 'KEYS_REWRAP_RUN');
    expect(runs.map((r) => r.result)).toEqual([AuditResult.FAILURE]);
    expect(t.app.get(KEY_SERVICE)).toBeDefined();
    await rewrap.run({ batchSize: 50 });
  });
});
