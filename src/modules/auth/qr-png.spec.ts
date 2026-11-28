import { crc32, inflateSync } from 'node:zlib';
import { encode } from 'uqr';
import { QR_BORDER, QR_SCALE, qrPngDataUri } from './qr-png.js';

/** Decodifica o PNG gerado: confere assinatura, CRC dos chunks, IHDR e devolve os pixels (true = preto). */
function decodePng(png: Buffer) {
  expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  let offset = 8;
  const chunks: Array<{ type: string; data: Buffer }> = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    expect(crc32(data, crc32(type))).toBe(crc);
    chunks.push({ type: type.toString('latin1'), data });
    offset += 12 + length;
  }
  expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  const ihdr = chunks[0].data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  expect([ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]]).toEqual([1, 0, 0, 0, 0]); // 1 bit, cinza, sem entrelaçar
  const raw = inflateSync(chunks[1].data);
  const rowBytes = Math.ceil(width / 8);
  const pixels: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    expect(raw[y * (rowBytes + 1)]).toBe(0); // filtro nenhum
    const row: boolean[] = [];
    for (let x = 0; x < width; x++) {
      const byte = raw[y * (rowBytes + 1) + 1 + (x >> 3)];
      row.push(((byte >> (7 - (x & 7))) & 1) === 0);
    }
    pixels.push(row);
  }
  return { width, height, pixels };
}

describe('QR code em PNG (feature 006, R5)', () => {
  const uri = 'otpauth://totp/Canal%20de%20Den%C3%BAncias:ana%40empresa.test?secret=JBSWY3DPEHPK3PXP&issuer=Canal';

  it('gera data URI PNG em base64', () => {
    expect(qrPngDataUri(uri)).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
  });

  it('o PNG decodificado reproduz a matriz do QR code, com escala e margem', () => {
    const png = Buffer.from(qrPngDataUri(uri).split(',')[1], 'base64');
    const { width, height, pixels } = decodePng(png);
    const qr = encode(uri, { ecc: 'M', border: QR_BORDER });
    expect(width).toBe(qr.size * QR_SCALE);
    expect(height).toBe(width);
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        const cell = pixels[y * QR_SCALE][x * QR_SCALE];
        expect(cell).toBe(qr.data[y][x]);
      }
    }
    // A margem é branca.
    expect(pixels[0].every((p) => !p)).toBe(true);
  });

  it('URIs diferentes geram imagens diferentes', () => {
    expect(qrPngDataUri(uri)).not.toBe(qrPngDataUri(`${uri}x`));
  });
});
