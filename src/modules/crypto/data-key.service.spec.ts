import type { DataKey, KeyService } from '../../infra/vault/key-service.js';
import { ContentUnavailableError } from './crypto.errors.js';
import { DataKeyService } from './data-key.service.js';

const WRAPPED = 'vault:v1:WRAPPED-XQZ';

function fakeKeys() {
  const handed: Buffer[] = [];
  const keys = {
    generateDataKey: vi.fn(async (): Promise<DataKey> => {
      const plaintext = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
      handed.push(plaintext);
      return { plaintext, wrapped: WRAPPED };
    }),
    decryptDataKey: vi.fn(async () => {
      const plaintext = Buffer.from(Array.from({ length: 32 }, (_, i) => 200 - i));
      handed.push(plaintext);
      return plaintext;
    }),
  };
  return { keys: keys as unknown as KeyService & typeof keys, handed };
}

const zeroed = (b: Buffer) => b.every((x) => x === 0);

describe('DataKeyService', () => {
  it('createReportKey entrega a DEK, devolve o wrapped e zera a DEK e o buffer intermediário', async () => {
    const { keys, handed } = fakeKeys();
    let seen: Buffer | undefined;
    const out = await new DataKeyService(keys).createReportKey((dek) => {
      seen = dek;
      expect(zeroed(dek)).toBe(false);
      return 'ok';
    });
    expect(out).toEqual({ result: 'ok', wrapped: WRAPPED });
    expect(keys.generateDataKey).toHaveBeenCalledWith('report-kek');
    expect(zeroed(seen!)).toBe(true);
    expect(zeroed(handed[0])).toBe(true);
  });

  it('withReportKey zera a DEK depois de fn, inclusive quando fn lança erro', async () => {
    const { keys, handed } = fakeKeys();
    const svc = new DataKeyService(keys);
    let seen: Buffer | undefined;
    await expect(
      svc.withReportKey(WRAPPED, async (dek) => {
        seen = dek;
        throw new Error('falha no meio');
      }),
    ).rejects.toThrow('falha no meio');
    expect(keys.decryptDataKey).toHaveBeenCalledWith('report-kek', WRAPPED);
    expect(zeroed(seen!)).toBe(true);
    expect(zeroed(handed[0])).toBe(true);
  });

  it('a DEK entregue não é do pool compartilhado de Buffers', async () => {
    const { keys } = fakeKeys();
    await new DataKeyService(keys).withReportKey(WRAPPED, (dek) => {
      expect(dek.length).toBe(32);
      expect(dek.byteOffset).toBe(0);
      expect(dek.buffer.byteLength).toBe(32);
    });
  });

  it('wrapped nulo (expurgado) gera ContentUnavailableError sem chamar o Vault', async () => {
    const { keys } = fakeKeys();
    const fn = vi.fn();
    await expect(new DataKeyService(keys).withReportKey(null, fn)).rejects.toBeInstanceOf(ContentUnavailableError);
    expect(keys.decryptDataKey).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it('só usa a report-kek', async () => {
    const { keys } = fakeKeys();
    const svc = new DataKeyService(keys);
    await svc.createReportKey(() => undefined);
    await svc.withReportKey(WRAPPED, () => undefined);
    for (const call of [...keys.generateDataKey.mock.calls, ...keys.decryptDataKey.mock.calls]) {
      expect((call as unknown[])[0]).toBe('report-kek');
    }
  });
});
