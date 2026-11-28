import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { StorageService } from '../../src/infra/storage/storage.service.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

const MB = 1024 * 1024;

/** Gera `total` bytes aleatórios em pedaços de 1 MB, sem montar o arquivo inteiro em memória. */
function randomStream(total: number, hash: ReturnType<typeof createHash>): Readable {
  let sent = 0;
  return new Readable({
    read() {
      if (sent >= total) return this.push(null);
      const chunk = randomBytes(Math.min(MB, total - sent));
      sent += chunk.length;
      hash.update(chunk);
      this.push(chunk);
    },
  });
}

async function hashOf(stream: Readable): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Contra o SeaweedFS do docker compose (ou o do CI), num bucket só desta execução. */
describe('Storage S3 (e2e)', () => {
  let t: TestApp;
  let storage: StorageService;
  const bucket = `teste-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    process.env.S3_BUCKET = bucket;
    t = await createTestApp();
    storage = t.app.get(StorageService);
  });

  afterAll(async () => {
    await storage.dropBucketForTests();
    await t.close();
  });

  it('com NODE_ENV=test o bucket não é criado na inicialização', async () => {
    expect(await storage.bucketExists()).toBe(false);
    await storage.ensureBucket();
    expect(await storage.bucketExists()).toBe(true);
  });

  it('grava e lê 20 MB em stream, com conteúdo íntegro', async () => {
    const key = randomUUID();
    const written = createHash('sha256');
    await storage.put(key, randomStream(20 * MB, written));
    expect(await storage.head(key)).toEqual({ size: 20 * MB });
    expect(await hashOf(await storage.get(key))).toBe(written.digest('hex'));
  });

  it('head de objeto inexistente devolve null', async () => {
    expect(await storage.head(randomUUID())).toBeNull();
  });

  it('get de objeto inexistente falha com erro próprio, sem citar a chave', async () => {
    const key = randomUUID();
    const error = await storage.get(key).catch((e: Error) => e);
    expect((error as Error).name).toBe('StorageObjectNotFoundError');
    expect((error as Error).message).not.toContain(key);
  });

  it('apaga um e apaga em lote', async () => {
    const keys = [randomUUID(), randomUUID(), randomUUID()];
    for (const key of keys) await storage.put(key, Readable.from([Buffer.from('x')]), 1);
    await storage.delete(keys[0]!);
    expect(await storage.head(keys[0]!)).toBeNull();
    await storage.deleteMany(keys.slice(1));
    for (const key of keys) expect(await storage.head(key)).toBeNull();
  });
});
