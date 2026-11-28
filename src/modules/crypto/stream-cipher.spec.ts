import { createHash, randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import v8 from 'node:v8';
import vm from 'node:vm';
import { DecryptionFailedError, UnsupportedFormatError } from './crypto.errors.js';
import { encryptionContext } from './encryption-context.js';
import { newRecordId } from './record-id.js';
import { createDecryptStream, createEncryptStream } from './stream-cipher.js';

const CHUNK = 64 * 1024;
const HEADER = 13;
const TAG = 16;
const dek = randomBytes(32);
const ctx = encryptionContext('attachments.object', newRecordId());

async function encrypt(plain: Buffer, key = dek, c = ctx): Promise<{ data: Buffer; sha256: string }> {
  const parts: Buffer[] = [];
  const enc = createEncryptStream(key, c);
  await pipeline(Readable.from(split(plain, 10_000)), enc.stream, collect(parts));
  return { data: Buffer.concat(parts), sha256: enc.ciphertextSha256() };
}

async function decrypt(data: Buffer, key = dek, c = ctx): Promise<Buffer> {
  const parts: Buffer[] = [];
  await pipeline(Readable.from(split(data, 7_777)), createDecryptStream(key, c), collect(parts));
  return Buffer.concat(parts);
}

function split(b: Buffer, size: number): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < b.length; i += size) out.push(b.subarray(i, i + size));
  return out;
}

function collect(parts: Buffer[]): Writable {
  return new Writable({
    write(chunk: Buffer, _enc, cb) {
      parts.push(chunk);
      cb();
    },
  });
}

describe('stream-cipher (STREAM v1)', () => {
  it.each([
    ['0 byte', 0],
    ['1 byte', 1],
    ['exatamente 64 KiB', CHUNK],
    ['64 KiB + 1', CHUNK + 1],
    ['3 blocos e meio', CHUNK * 3 + CHUNK / 2],
  ])('ida e volta: %s', async (_caso, size) => {
    const plain = randomBytes(size);
    const { data } = await encrypt(plain);
    const blocks = Math.max(1, Math.ceil(size / CHUNK));
    expect(data.length).toBe(HEADER + size + blocks * TAG);
    expect((await decrypt(data)).equals(plain)).toBe(true);
  });

  it('o sha256 informado é o dos bytes cifrados emitidos (cabeçalho incluído)', async () => {
    const { data, sha256 } = await encrypt(randomBytes(CHUNK + 10));
    expect(sha256).toBe(createHash('sha256').update(data).digest('hex'));
  });

  it('cabeçalho: versão 1, bloco de 64 KiB e prefixo de nonce aleatório', async () => {
    const a = (await encrypt(Buffer.from('XQZ'))).data;
    const b = (await encrypt(Buffer.from('XQZ'))).data;
    expect(a[0]).toBe(1);
    expect(a.readUInt32BE(1)).toBe(CHUNK);
    expect(a.subarray(5, 13).equals(b.subarray(5, 13))).toBe(false);
  });

  const twoBlocks = () => encrypt(randomBytes(CHUNK * 2 + 100)).then((r) => r.data);

  it('arquivo cortado no fim de um bloco falha (sem o bloco final)', async () => {
    const data = await twoBlocks();
    await expect(decrypt(data.subarray(0, HEADER + 2 * (CHUNK + TAG)))).rejects.toBeInstanceOf(DecryptionFailedError);
    await expect(decrypt(data.subarray(0, HEADER + (CHUNK + TAG)))).rejects.toBeInstanceOf(DecryptionFailedError);
  });

  it('arquivo cortado no meio de um bloco falha', async () => {
    const data = await twoBlocks();
    await expect(decrypt(data.subarray(0, data.length - 50))).rejects.toBeInstanceOf(DecryptionFailedError);
    await expect(decrypt(data.subarray(0, HEADER + 5))).rejects.toBeInstanceOf(DecryptionFailedError);
  });

  it('blocos trocados de ordem falham', async () => {
    const data = await twoBlocks();
    const b0 = data.subarray(HEADER, HEADER + CHUNK + TAG);
    const b1 = data.subarray(HEADER + CHUNK + TAG, HEADER + 2 * (CHUNK + TAG));
    const swapped = Buffer.concat([data.subarray(0, HEADER), b1, b0, data.subarray(HEADER + 2 * (CHUNK + TAG))]);
    await expect(decrypt(swapped)).rejects.toBeInstanceOf(DecryptionFailedError);
  });

  it('byte alterado em qualquer bloco, prefixo de nonce alterado ou chave diferente falham', async () => {
    const data = await twoBlocks();
    for (const pos of [HEADER + 10, HEADER + CHUNK + TAG + 10, data.length - 1, 7]) {
      const bad = Buffer.from(data);
      bad[pos] ^= 0x01;
      await expect(decrypt(bad)).rejects.toBeInstanceOf(DecryptionFailedError);
    }
    await expect(decrypt(data, randomBytes(32))).rejects.toBeInstanceOf(DecryptionFailedError);
  });

  it('arquivo de outro anexo (contexto diferente) falha', async () => {
    const { data } = await encrypt(Buffer.from('XQZ'));
    await expect(decrypt(data, dek, encryptionContext('attachments.object', newRecordId()))).rejects.toBeInstanceOf(
      DecryptionFailedError,
    );
  });

  it('versão ou tamanho de bloco desconhecidos e cabeçalho incompleto geram erro de formato', async () => {
    const { data } = await encrypt(Buffer.from('XQZ'));
    const v2 = Buffer.from(data);
    v2[0] = 2;
    await expect(decrypt(v2)).rejects.toBeInstanceOf(UnsupportedFormatError);
    const otherChunk = Buffer.from(data);
    otherChunk.writeUInt32BE(1024, 1);
    await expect(decrypt(otherChunk)).rejects.toBeInstanceOf(UnsupportedFormatError);
    await expect(decrypt(data.subarray(0, 6))).rejects.toBeInstanceOf(UnsupportedFormatError);
    await expect(decrypt(Buffer.alloc(0))).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it('a falha não carrega texto em claro, chave nem cifrado', async () => {
    const plain = Buffer.from('XQZ-RELATO-DO-ANEXO');
    const { data } = await encrypt(plain);
    const bad = Buffer.from(data);
    bad[bad.length - 1] ^= 0x01;
    const error = await decrypt(bad).catch((e: unknown) => e);
    const text = [String(error), (error as Error).stack, JSON.stringify(error)].join('\n');
    for (const s of ['XQZ', dek.toString('hex'), dek.toString('base64'), data.toString('base64').slice(0, 40)]) {
      expect(text).not.toContain(s);
    }
  });

  it('a chave entregue pode ser zerada pelo chamador logo depois de criar o stream', async () => {
    const key = Buffer.from(dek);
    const enc = createEncryptStream(key, ctx);
    key.fill(0);
    const parts: Buffer[] = [];
    await pipeline(Readable.from([Buffer.from('XQZ')]), enc.stream, collect(parts));
    expect((await decrypt(Buffer.concat(parts))).toString()).toBe('XQZ');
  });

  it('10 MB cifrados e decifrados aos pedaços com crescimento de memória abaixo de 5 MB (SC-004)', async () => {
    v8.setFlagsFromString('--expose-gc');
    // A liberação dos ArrayBuffers é concorrente e atrasa com a máquina carregada; síncrona, a amostra mede só o retido.
    v8.setFlagsFromString('--no-concurrent-array-buffer-sweeping');
    const gc = vm.runInNewContext('gc') as () => void;
    const TOTAL = 10 * 1024 * 1024;
    const PIECE = 16 * 1024;
    const piece = randomBytes(PIECE);
    let produced = 0;
    async function* source() {
      while (produced < TOTAL) {
        produced += PIECE;
        yield Buffer.from(piece);
      }
    }
    const usage = () => {
      const m = process.memoryUsage();
      return m.heapUsed + m.arrayBuffers;
    };
    gc();
    const baseline = usage();
    // Memória viva (U1): coleta antes de cada amostra, para medir o que o streaming retém, não o lixo ainda não
    // coletado. Se o pipeline acumulasse o arquivo, a memória viva cresceria junto com os 10 MB.
    let peak = baseline;
    let received = 0;
    let writes = 0;
    const enc = createEncryptStream(dek, ctx);
    await pipeline(
      source,
      enc.stream,
      createDecryptStream(dek, ctx),
      new Writable({
        write(chunk: Buffer, _e, cb) {
          received += chunk.length;
          if (++writes % 16 === 0) {
            gc();
            peak = Math.max(peak, usage());
          }
          cb();
        },
      }),
    );
    const growthMb = (peak - baseline) / 1024 / 1024;
    console.info(`streaming de 10 MB: crescimento de memória viva de pico ${growthMb.toFixed(2)} MB`);
    expect(received).toBe(TOTAL);
    expect(growthMb).toBeLessThan(5);
  });
});
